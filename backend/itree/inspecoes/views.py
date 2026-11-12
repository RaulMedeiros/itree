from django.db.models import Case, IntegerField, Value, When
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from pghistory.models import Events
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from itree.auditoria.views import EventoAuditoriaSerializer
from itree.contas.acesso import filtrar_por_escopo, requer
from itree.contas.permissoes import Permissao
from itree.core.parametros import uuid_do_parametro

from . import servicos
from .models import CondicaoAparente, EstadoInspecao, Inspecao
from .serializers import (
    DevolucaoSerializer,
    EncaminhamentoResultadoSerializer,
    EncaminhamentoSerializer,
    InspecaoDeCampoSerializer,
    InspecaoResumoSerializer,
    InspecaoSerializer,
    LoteSincronizacaoSerializer,
    ResultadoSincronizacaoSerializer,
    ValidacaoSerializer,
)

P = Permissao

FILTROS = [
    OpenApiParameter("estado", str, description="Um ou mais, separados por vírgula."),
    OpenApiParameter("tecnico", str),
    OpenApiParameter("arvore", str),
    OpenApiParameter("bairro", str),
    OpenApiParameter("desde", str, description="AAAA-MM-DD (data da inspeção)"),
    OpenApiParameter("ate", str, description="AAAA-MM-DD"),
    OpenApiParameter("requer_encaminhamento", bool),
    OpenApiParameter("condicao", str, description="Uma ou mais condições, separadas por vírgula."),
    OpenApiParameter(
        "ordenar",
        str,
        description="realizada_em, recebida_em ou condicao (da pior para a melhor), com '-' "
        "na frente para inverter. Padrão: -realizada_em.",
    ),
]

ORDENACOES = {"realizada_em", "recebida_em"}
# Da pior condição para a melhor; "não avaliada" por último.
ESCALA_CONDICAO = [
    CondicaoAparente.MORTA,
    CondicaoAparente.RUIM,
    CondicaoAparente.REGULAR,
    CondicaoAparente.BOA,
    CondicaoAparente.NAO_AVALIADA,
]


def ordenar_inspecoes(qs, ordem: str):
    """Ordenação da listagem; valor desconhecido cai no padrão (mais recentes primeiro)."""
    descendente = ordem.startswith("-")
    campo = ordem.lstrip("-")
    if campo == "condicao":
        peso = Case(
            *[When(condicao_aparente=c, then=Value(i)) for i, c in enumerate(ESCALA_CONDICAO)],
            default=Value(len(ESCALA_CONDICAO)),
            output_field=IntegerField(),
        )
        return qs.order_by(peso.desc() if descendente else peso.asc(), "recebida_em")
    if campo in ORDENACOES:
        return qs.order_by(ordem, "numero")
    return qs.order_by("-realizada_em")


def filtrar_inspecoes(qs, p):
    """Filtros da listagem de inspeções, compartilhados com a exportação."""
    if estado := p.get("estado"):
        qs = qs.filter(estado__in=estado.split(","))
    for campo in ("tecnico", "arvore"):
        if valor := p.get(campo):
            qs = qs.filter(**{f"{campo}_id": uuid_do_parametro(valor, campo)})
    if bairro := p.get("bairro"):
        qs = qs.filter(arvore__bairro_id=uuid_do_parametro(bairro, "bairro"))
    if desde := p.get("desde"):
        qs = qs.filter(realizada_em__date__gte=desde)
    if ate := p.get("ate"):
        qs = qs.filter(realizada_em__date__lte=ate)
    if p.get("requer_encaminhamento") == "true":
        qs = qs.filter(requer_encaminhamento=True)
    if condicao := p.get("condicao"):
        qs = qs.filter(condicao_aparente__in=condicao.split(","))
    return qs


@extend_schema_view(
    list=extend_schema(operation_id="inspecoes_listar", parameters=FILTROS),
    retrieve=extend_schema(operation_id="inspecoes_obter"),
)
class InspecaoViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Consulta, revisão e validação de inspeções (W-05)."""

    lookup_value_converter = "uuid"

    def get_permissions(self):
        mapa = {
            "validar": P.INSPECOES_VALIDAR,
            "validar_e_encaminhar": P.INSPECOES_VALIDAR,
            "devolver": P.INSPECOES_VALIDAR,
            "sincronizar": P.INSPECOES_EXECUTAR,
        }
        return [requer(mapa.get(self.action, P.INSPECOES_LER))()]

    def get_serializer_class(self):
        return InspecaoResumoSerializer if self.action == "list" else InspecaoSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Inspecao.objects.none()
        qs = Inspecao.objects.select_related(
            "arvore", "arvore__especie", "arvore__bairro", "tecnico", "revisor", "especie", "tarefa"
        ).prefetch_related("medidas", "medidas__responsavel", "ocorrencias_geradas")
        qs = filtrar_por_escopo(qs, self.request.user, campo_geom="arvore__geom")
        if self.action != "list":
            return qs
        p = self.request.query_params
        qs = filtrar_inspecoes(qs, p)
        return ordenar_inspecoes(qs, p.get("ordenar", "-realizada_em"))

    @extend_schema(
        operation_id="inspecoes_sincronizar",
        request=LoteSincronizacaoSerializer,
        responses=ResultadoSincronizacaoSerializer(many=True),
        description="Recebe inspeções do aplicativo. Cada item tem resultado próprio; "
        "reenvios são idempotentes e conflitos nunca são resolvidos em silêncio.",
    )
    @action(detail=False, methods=["post"], pagination_class=None)
    def sincronizar(self, request):
        lote = LoteSincronizacaoSerializer(data=request.data)
        lote.is_valid(raise_exception=True)
        resultados = []
        for bruto in lote.validated_data["inspecoes"]:
            item = InspecaoDeCampoSerializer(data=bruto)
            if not item.is_valid():
                resultados.append(
                    servicos.Resultado(
                        str(bruto.get("id", "")),
                        "erro",
                        mensagem="Dados inválidos.",
                        erros=item.errors,
                    )
                )
                continue
            resultados.append(
                servicos.sincronizar_item(
                    item.validated_data, request.user, lote.validated_data["dispositivo"]
                )
            )
        return Response(
            ResultadoSincronizacaoSerializer([r.__dict__ for r in resultados], many=True).data
        )

    @extend_schema(
        operation_id="inspecoes_validar", request=ValidacaoSerializer, responses=InspecaoSerializer
    )
    @action(detail=True, methods=["post"])
    def validar(self, request, pk=None):
        dados = ValidacaoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        try:
            servicos.validar(
                self.get_object(),
                request.user,
                dados.validated_data["aplicar"],
                dados.validated_data.get("motivo", ""),
            )
        except servicos.ErroInspecao as exc:
            raise ValidationError(str(exc)) from exc
        return Response(InspecaoSerializer(self.get_object()).data)

    @extend_schema(
        operation_id="inspecoes_validar_e_encaminhar",
        request=EncaminhamentoSerializer,
        responses=EncaminhamentoResultadoSerializer,
        description="Valida a inspeção e abre, na mesma operação, a ocorrência vinculada a ela "
        "(com tarefa de atendimento opcional). Exige também registrar ocorrências e, para a "
        "tarefa, criar tarefas.",
    )
    @action(detail=True, methods=["post"], url_path="validar-e-encaminhar")
    def validar_e_encaminhar(self, request, pk=None):
        usuario = request.user
        if not usuario.tem_permissao(P.OCORRENCIAS_EDITAR):
            raise PermissionDenied("Você não pode registrar ocorrências.")
        dados = EncaminhamentoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        v = dados.validated_data
        if v["criar_tarefa"] and not usuario.tem_permissao(P.TAREFAS_EDITAR):
            raise PermissionDenied("Você não pode criar tarefas.")
        try:
            resultado = servicos.validar_e_encaminhar(
                self.get_object(),
                usuario,
                aplicar=v["aplicar"],
                tipo=v["tipo_id"],
                motivo=v.get("motivo", ""),
                descricao=v.get("descricao", ""),
                prazo=v.get("prazo"),
                criar_tarefa=v["criar_tarefa"],
                responsavel=v.get("responsavel"),
                equipe=v.get("equipe"),
            )
        except servicos.ErroInspecao as exc:
            raise ValidationError(str(exc)) from exc
        return Response(
            {
                "inspecao": InspecaoSerializer(self.get_object()).data,
                "ocorrencia": {
                    "id": str(resultado.ocorrencia.pk),
                    "codigo": resultado.ocorrencia.codigo,
                },
                "tarefa": (
                    {"id": str(resultado.tarefa.pk), "codigo": resultado.tarefa.codigo}
                    if resultado.tarefa
                    else None
                ),
            }
        )

    @extend_schema(
        operation_id="inspecoes_devolver", request=DevolucaoSerializer, responses=InspecaoSerializer
    )
    @action(detail=True, methods=["post"])
    def devolver(self, request, pk=None):
        dados = DevolucaoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        try:
            servicos.devolver(self.get_object(), request.user, dados.validated_data["motivo"])
        except servicos.ErroInspecao as exc:
            raise ValidationError(str(exc)) from exc
        return Response(InspecaoSerializer(self.get_object()).data)

    @extend_schema(
        operation_id="inspecoes_historico", responses=EventoAuditoriaSerializer(many=True)
    )
    @action(detail=True, pagination_class=None)
    def historico(self, request, pk=None):
        inspecao = self.get_object()
        eventos = Events.objects.references(inspecao).order_by("-pgh_created_at", "-pgh_id")[:500]
        return Response(EventoAuditoriaSerializer(eventos, many=True).data)


def resumo_fila(usuario) -> dict:
    qs = filtrar_por_escopo(Inspecao.objects.all(), usuario, campo_geom="arvore__geom")
    em_revisao = qs.filter(estado=EstadoInspecao.EM_REVISAO)
    mais_antiga = em_revisao.order_by("recebida_em").values_list("recebida_em", flat=True).first()
    return {
        "em_revisao": em_revisao.count(),
        "mais_antiga_dias": (timezone.now() - mais_antiga).days if mais_antiga else None,
    }
