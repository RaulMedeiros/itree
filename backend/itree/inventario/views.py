import re

import pghistory
from django.db import transaction
from django.db.models import CharField, Count, F, Func, Q, Value
from drf_spectacular.utils import (
    OpenApiParameter,
    extend_schema,
    extend_schema_view,
    inline_serializer,
)
from pghistory.models import Events
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from itree.auditoria.views import EventoAuditoriaSerializer
from itree.contas.acesso import filtrar_por_escopo, ponto_no_escopo, requer
from itree.contas.permissoes import Permissao
from itree.core.parametros import uuid_do_parametro
from itree.ocorrencias.models import ESTADOS_FINAIS

from . import duplicidades, importacao
from .models import (
    Arvore,
    Especie,
    EstadoLote,
    LoteImportacao,
    OrigemRegistro,
    ParNaoDuplicado,
    SituacaoArvore,
)
from .serializers import (
    AcaoComMotivoSerializer,
    ArvoreResumoSerializer,
    ArvoreSerializer,
    ColunasArquivoSerializer,
    ContadoresSerializer,
    EspecieSerializer,
    FusaoSerializer,
    LoteImportacaoDetalheSerializer,
    LoteImportacaoSerializer,
    MedidaSerializer,
    NovaImportacaoSerializer,
    ParDuplicidadeSerializer,
    ParRevisadoSerializer,
)

P = Permissao


def _com_motivo(request):
    return pghistory.context(motivo=(request.data.get("motivo") or None))


@extend_schema_view(
    list=extend_schema(
        operation_id="especies_listar",
        parameters=[
            OpenApiParameter("busca", str),
            OpenApiParameter("ativa", bool),
        ],
    ),
    retrieve=extend_schema(operation_id="especies_obter"),
    create=extend_schema(operation_id="especies_criar"),
    partial_update=extend_schema(operation_id="especies_atualizar"),
)
class EspecieViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Catálogo de espécies. Espécies não são excluídas; ficam inativas."""

    serializer_class = EspecieSerializer
    http_method_names = ["get", "post", "patch"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [requer(P.INVENTARIO_LER)()]
        return [requer(P.ADMIN_CONFIGURACAO)()]

    def get_queryset(self):
        qs = Especie.objects.all()
        p = self.request.query_params
        if busca := p.get("busca"):
            nomes = Func(
                F("nomes_comuns"), Value(" "), function="array_to_string", output_field=CharField()
            )
            qs = qs.annotate(_nomes=nomes).filter(
                Q(nome_cientifico__icontains=busca)
                | Q(_nomes__icontains=busca)
                | Q(familia__icontains=busca)
            )
        if (ativa := p.get("ativa")) in ("true", "false"):
            qs = qs.filter(ativa=ativa == "true")
        return qs


FILTROS_ARVORE = [
    OpenApiParameter(
        "busca", str, description="Código (ARV-000123), identificador externo ou endereço."
    ),
    OpenApiParameter("especie", str),
    OpenApiParameter("especie_estado", str),
    OpenApiParameter("bairro", str),
    OpenApiParameter("localizacao_origem", str),
    OpenApiParameter(
        "situacao", str, description="Padrão: ativa. Use 'todas' para incluir as demais."
    ),
    OpenApiParameter("valida", bool),
    OpenApiParameter("lote", str),
    OpenApiParameter("ordenar", str, description="numero, -numero, atualizado_em, -atualizado_em"),
]


def filtrar_arvores(qs, params):
    if busca := params.get("busca", "").strip():
        if m := re.fullmatch(r"(?i)(?:arv-?)?0*(\d+)", busca):
            qs = qs.filter(Q(numero=int(m.group(1))) | Q(identificadores__valor=busca))
        else:
            qs = qs.filter(Q(endereco__icontains=busca) | Q(identificadores__valor=busca))
    for campo, consulta in (
        ("especie", "especie_id"),
        ("bairro", "bairro_id"),
        ("lote", "lote_id"),
        ("especie_estado", "especie_estado"),
        ("localizacao_origem", "localizacao_origem"),
    ):
        if valor := params.get(campo):
            if consulta.endswith("_id"):
                valor = uuid_do_parametro(valor, campo)
            qs = qs.filter(**{consulta: valor})
    situacao = params.get("situacao", "ativa")
    if situacao != "todas":
        qs = qs.filter(situacao=situacao)
    if (valida := params.get("valida")) in ("true", "false"):
        condicao = Q(situacao=SituacaoArvore.ATIVA, geom__isnull=False) & ~Q(localizacao_origem="")
        qs = qs.filter(condicao) if valida == "true" else qs.exclude(condicao)
    return qs.distinct()


@extend_schema_view(
    list=extend_schema(operation_id="arvores_listar", parameters=FILTROS_ARVORE),
    retrieve=extend_schema(operation_id="arvores_obter"),
    create=extend_schema(operation_id="arvores_criar"),
    partial_update=extend_schema(operation_id="arvores_atualizar"),
)
class ArvoreViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Inventário arbóreo (W-03). Restrito ao escopo territorial do usuário."""

    http_method_names = ["get", "post", "patch"]

    def get_permissions(self):
        if self.action in ("list", "retrieve", "historico", "contadores", "duplicidades"):
            return [requer(P.INVENTARIO_LER)()]
        if self.action in ("excluir", "fundir", "nao_duplicadas"):
            return [requer(P.INVENTARIO_FUNDIR_EXCLUIR)()]
        return [requer(P.INVENTARIO_EDITAR)()]

    def get_serializer_class(self):
        return ArvoreResumoSerializer if self.action == "list" else ArvoreSerializer

    def get_queryset(self):
        qs = Arvore.objects.select_related("especie", "bairro", "lote", "criado_por").annotate(
            ocorrencias_abertas=Count(
                "ocorrencias", filter=~Q(ocorrencias__estado__in=ESTADOS_FINAIS), distinct=True
            )
        )
        qs = filtrar_por_escopo(qs, self.request.user, incluir_sem_geom=True)
        if self.action == "list":
            qs = filtrar_arvores(qs, self.request.query_params)
            ordem = self.request.query_params.get("ordenar", "-numero")
            if ordem.lstrip("-") in ("numero", "atualizado_em"):
                qs = qs.order_by(ordem)
        return qs

    def _verificar_escopo(self, geom):
        if geom is not None and not ponto_no_escopo(self.request.user, geom):
            raise ValidationError(
                {"localizacao": ["A localização está fora do seu escopo territorial."]}
            )

    def perform_create(self, serializer):
        self._verificar_escopo(serializer.validated_data.get("geom"))
        with _com_motivo(self.request):
            serializer.save(origem_registro=OrigemRegistro.WEB, criado_por=self.request.user)

    def perform_update(self, serializer):
        if serializer.instance.situacao != SituacaoArvore.ATIVA:
            raise ValidationError("Registros excluídos ou fundidos não podem ser editados.")
        if "geom" in serializer.validated_data:
            self._verificar_escopo(serializer.validated_data["geom"])
        with _com_motivo(self.request):
            serializer.save()

    @extend_schema(
        operation_id="arvores_contadores", parameters=FILTROS_ARVORE, responses=ContadoresSerializer
    )
    @action(detail=False)
    def contadores(self, request):
        """Total de registros e registros válidos com os mesmos filtros (RF-INV-003)."""
        base = filtrar_por_escopo(Arvore.objects.all(), request.user, incluir_sem_geom=True)
        params = request.query_params.copy()
        params.setdefault("situacao", "todas")
        qs = filtrar_arvores(base, params)
        validos = qs.filter(situacao=SituacaoArvore.ATIVA, geom__isnull=False).exclude(
            localizacao_origem=""
        )
        return Response({"total": qs.count(), "validos": validos.count()})

    @extend_schema(operation_id="arvores_historico", responses=EventoAuditoriaSerializer(many=True))
    @action(detail=True, pagination_class=None)
    def historico(self, request, pk=None):
        """Alterações da árvore e de suas medidas e identificadores (RF-INV-003)."""
        arvore = self.get_object()
        eventos = Events.objects.references(arvore).order_by("-pgh_created_at", "-pgh_id")[:500]
        return Response(EventoAuditoriaSerializer(eventos, many=True).data)

    @extend_schema(
        operation_id="arvores_medidas_criar",
        request=MedidaSerializer,
        responses={201: MedidaSerializer},
    )
    @action(detail=True, methods=["post"], url_path="medidas")
    def medidas(self, request, pk=None):
        arvore = self.get_object()
        if arvore.situacao != SituacaoArvore.ATIVA:
            raise ValidationError("Registros excluídos ou fundidos não recebem medidas.")
        serializer = MedidaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(arvore=arvore, responsavel=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        operation_id="arvores_excluir", request=AcaoComMotivoSerializer, responses=ArvoreSerializer
    )
    @action(detail=True, methods=["post"])
    def excluir(self, request, pk=None):
        """Exclusão lógica, auditada e com justificativa (RN-INV-004)."""
        arvore = self.get_object()
        dados = AcaoComMotivoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        if arvore.situacao != SituacaoArvore.ATIVA:
            raise ValidationError("A árvore já não está ativa.")
        with pghistory.context(motivo=dados.validated_data["motivo"]):
            arvore.situacao = SituacaoArvore.EXCLUIDA
            arvore.motivo_situacao = dados.validated_data["motivo"]
            arvore.save(update_fields=["situacao", "motivo_situacao", "atualizado_em"])
        return Response(ArvoreSerializer(self.get_object(), context={"request": request}).data)

    @extend_schema(
        operation_id="arvores_fundir", request=FusaoSerializer, responses=ArvoreSerializer
    )
    @action(detail=True, methods=["post"])
    def fundir(self, request, pk=None):
        """Funde outro registro neste (RF-INV-014). Exige justificativa."""
        manter = self.get_object()
        dados = FusaoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        descartar = dados.validated_data["descartar"]
        visiveis = self.get_queryset()
        if not visiveis.filter(pk=descartar.pk).exists():
            raise PermissionDenied("O outro registro está fora do seu escopo.")
        if descartar.pk == manter.pk:
            raise ValidationError({"descartar": "Escolha um registro diferente."})
        if manter.situacao != SituacaoArvore.ATIVA or descartar.situacao != SituacaoArvore.ATIVA:
            raise ValidationError("Só registros ativos podem ser fundidos.")
        try:
            with pghistory.context(
                motivo=dados.validated_data["motivo"],
                evento="fusao_arvores",
                fundida=str(descartar.pk),
            ):
                duplicidades.fundir(manter, descartar, dados.validated_data["campos_da_outra"])
        except ValueError as exc:
            raise ValidationError({"campos_da_outra": str(exc)}) from exc
        return Response(ArvoreSerializer(self.get_object(), context={"request": request}).data)

    @extend_schema(
        operation_id="arvores_duplicidades",
        parameters=[
            OpenApiParameter("raio", float, description="Distância máxima em metros (padrão 3).")
        ],
        responses=ParDuplicidadeSerializer(many=True),
    )
    @action(detail=False, pagination_class=None)
    def duplicidades(self, request):
        """Pares suspeitos para revisão humana (RF-INV-013). Nunca há fusão automática."""
        try:
            raio = min(
                max(float(request.query_params.get("raio", duplicidades.RAIO_PADRAO_M)), 0.5), 50
            )
        except ValueError:
            raio = duplicidades.RAIO_PADRAO_M
        visiveis = filtrar_por_escopo(Arvore.objects.all(), request.user)
        pares = duplicidades.pares_suspeitos(visiveis, raio_m=raio)
        ids = {p["arvore_a"] for p in pares} | {p["arvore_b"] for p in pares}
        arvores = {a.id: a for a in self.get_queryset().filter(id__in=ids)}
        resultado = [
            {**p, "arvore_a": arvores[p["arvore_a"]], "arvore_b": arvores[p["arvore_b"]]}
            for p in pares
            if p["arvore_a"] in arvores and p["arvore_b"] in arvores
        ]
        return Response(ParDuplicidadeSerializer(resultado, many=True).data)

    @extend_schema(
        operation_id="arvores_nao_duplicadas", request=ParRevisadoSerializer, responses={204: None}
    )
    @action(detail=False, methods=["post"], url_path="nao-duplicadas")
    def nao_duplicadas(self, request):
        dados = ParRevisadoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        a, b = sorted(
            [dados.validated_data["arvore_a"], dados.validated_data["arvore_b"]], key=lambda x: x.pk
        )
        visiveis = self.get_queryset()
        if visiveis.filter(pk__in=[a.pk, b.pk]).count() != 2:
            raise PermissionDenied("Um dos registros está fora do seu escopo.")
        ParNaoDuplicado.objects.get_or_create(
            arvore_a=a, arvore_b=b, defaults={"revisado_por": request.user}
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema_view(
    list=extend_schema(operation_id="importacoes_listar"),
    retrieve=extend_schema(operation_id="importacoes_obter"),
)
class ImportacaoViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Importação em lote com pré-visualização, confirmação e desfazer (RF-INV-010 a 012)."""

    permission_classes = [requer(P.INVENTARIO_IMPORTAR)]

    def get_queryset(self):
        return LoteImportacao.objects.select_related("usuario")

    def get_serializer_class(self):
        return (
            LoteImportacaoDetalheSerializer
            if self.action == "retrieve"
            else LoteImportacaoSerializer
        )

    @staticmethod
    def _formato(nome: str) -> str:
        nome = nome.lower()
        if nome.endswith(".csv") or nome.endswith(".txt"):
            return "csv"
        if nome.endswith(".geojson") or nome.endswith(".json"):
            return "geojson"
        raise ValidationError({"arquivo": "Use um arquivo .csv ou .geojson."})

    @extend_schema(
        operation_id="importacoes_colunas",
        request={"multipart/form-data": ColunasArquivoSerializer},
        responses=inline_serializer(
            "ColunasArquivo",
            {
                "formato": serializers.CharField(),
                "colunas": serializers.ListField(child=serializers.CharField()),
                "total_linhas": serializers.IntegerField(),
                "amostra": serializers.ListField(child=serializers.DictField()),
                "tem_geometria": serializers.BooleanField(),
            },
        ),
    )
    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser])
    def colunas(self, request):
        """Lê o cabeçalho do arquivo para montar o mapeamento de colunas."""
        dados = ColunasArquivoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        arquivo = dados.validated_data["arquivo"]
        formato = self._formato(arquivo.name)
        try:
            colunas, registros = importacao.ler_registros(arquivo.read(), formato)
        except importacao.ErroArquivo as exc:
            raise ValidationError({"arquivo": str(exc)}) from exc
        amostra = [{k: v for k, v in r.items() if not k.startswith("__")} for r in registros[:5]]
        return Response(
            {
                "formato": formato,
                "colunas": colunas,
                "total_linhas": len(registros),
                "amostra": amostra,
                "tem_geometria": any("__lon" in r for r in registros[:50]),
            }
        )

    @extend_schema(
        operation_id="importacoes_criar",
        request={"multipart/form-data": NovaImportacaoSerializer},
        responses={201: LoteImportacaoDetalheSerializer},
    )
    def create(self, request):
        """Interpreta e valida o arquivo. Nada é criado até a confirmação."""
        dados = NovaImportacaoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        v = dados.validated_data
        arquivo = v["arquivo"]
        formato = self._formato(arquivo.name)
        mapeamento = {
            nome: v.get(f"campo_{nome}")
            for nome in importacao.CAMPOS_MAPEAVEIS
            if v.get(f"campo_{nome}")
        }
        if formato == "csv" and not (mapeamento.get("latitude") and mapeamento.get("longitude")):
            raise ValidationError({"campo_latitude": "Indique as colunas de latitude e longitude."})
        try:
            _, registros = importacao.ler_registros(arquivo.read(), formato)
            linhas = importacao.interpretar(registros, mapeamento, v["srid"], fonte_ids=v["fonte"])
        except importacao.ErroArquivo as exc:
            raise ValidationError({"arquivo": str(exc)}) from exc
        except Exception as exc:  # noqa: BLE001 - SRC inválido, por exemplo
            raise ValidationError(
                {"srid": f"Não foi possível usar o SRC {v['srid']}: {exc}"}
            ) from exc
        lote = LoteImportacao.objects.create(
            arquivo_nome=arquivo.name[:255],
            formato=formato,
            fonte=v["fonte"],
            fonte_url=v.get("fonte_url", ""),
            data_referencia=v.get("data_referencia"),
            mapeamento={**mapeamento, "srid": v["srid"], "fonte_ids": v["fonte"]},
            usuario=request.user,
            total_linhas=len(linhas),
            linhas_validas=sum(1 for linha in linhas if not linha.erros),
            linhas=[linha.como_dict() for linha in linhas],
        )
        return Response(LoteImportacaoDetalheSerializer(lote).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        operation_id="importacoes_confirmar", request=None, responses=LoteImportacaoSerializer
    )
    @action(detail=True, methods=["post"])
    def confirmar(self, request, pk=None):
        lote = self.get_object()
        try:
            with pghistory.context(evento="importacao_inventario", lote=lote.numero):
                importacao.confirmar(lote, request.user)
        except importacao.ErroArquivo as exc:
            raise ValidationError(str(exc)) from exc
        lote.refresh_from_db()
        return Response(LoteImportacaoSerializer(lote).data)

    @extend_schema(
        operation_id="importacoes_descartar", request=None, responses=LoteImportacaoSerializer
    )
    @action(detail=True, methods=["post"])
    def descartar(self, request, pk=None):
        lote = self.get_object()
        if lote.estado != EstadoLote.PRE_VISUALIZADO:
            raise ValidationError("Só pré-visualizações podem ser descartadas.")
        lote.estado = EstadoLote.DESCARTADO
        lote.linhas = []
        lote.save(update_fields=["estado", "linhas", "atualizado_em"])
        return Response(LoteImportacaoSerializer(lote).data)

    @extend_schema(
        operation_id="importacoes_desfazer",
        request=AcaoComMotivoSerializer,
        responses=LoteImportacaoSerializer,
    )
    @action(detail=True, methods=["post"])
    def desfazer(self, request, pk=None):
        lote = self.get_object()
        dados = AcaoComMotivoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        try:
            with (
                transaction.atomic(),
                pghistory.context(
                    motivo=dados.validated_data["motivo"],
                    evento="desfazer_importacao",
                    lote=lote.numero,
                ),
            ):
                importacao.desfazer(lote)
        except importacao.ErroArquivo as exc:
            raise ValidationError(str(exc)) from exc
        lote.refresh_from_db()
        return Response(LoteImportacaoSerializer(lote).data)
