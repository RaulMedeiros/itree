import json
from datetime import timedelta

import pghistory
from django.conf import settings
from django.contrib.gis.db.models.functions import AsGeoJSON
from django.db import transaction
from drf_spectacular.utils import (
    OpenApiParameter,
    extend_schema,
    extend_schema_field,
    extend_schema_view,
)
from pghistory.models import Events
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from itree.auditoria.views import EventoAuditoriaSerializer
from itree.contas.acesso import requer
from itree.contas.permissoes import Permissao
from itree.core.lote import (
    IdsEmLoteSerializer,
    OperacaoEmLoteSerializer,
    ResultadoAcaoEmLoteSerializer,
    iniciar_acao_em_lote,
)
from itree.core.parametros import uuid_do_parametro
from itree.core.textos import sem_codigos_internos
from itree.ocorrencias.models import Ocorrencia, OrigemOcorrencia, TipoOcorrencia

from . import fontes, proximidade
from .escopo import filtrar_alertas_por_escopo
from .models import (
    EXIGEM_JUSTIFICATIVA,
    EXIGEM_REFERENCIA,
    FINAIS_ALERTA,
    TRANSICOES_ALERTA,
    AlertaAmbiental,
    FonteAlerta,
    IngestaoAlertas,
    StatusAlerta,
)

P = Permissao


class AlertaSerializer(serializers.ModelSerializer):
    codigo = serializers.CharField(read_only=True)
    geometria = serializers.SerializerMethodField(help_text="GeoJSON da geometria recebida.")
    tipo_geometria = serializers.SerializerMethodField()
    analisado_por = serializers.SerializerMethodField()
    ocorrencia = serializers.SerializerMethodField()
    arvores_proximas = serializers.IntegerField(
        read_only=True,
        default=None,
        help_text="Árvores ativas no escopo a até `raio` m (padrão 100 m) do alerta.",
    )
    ocorrencias_proximas = serializers.IntegerField(
        read_only=True,
        default=None,
        help_text="Ocorrências abertas no escopo a até `raio` m (padrão 100 m) do alerta.",
    )
    transicoes_possiveis = serializers.SerializerMethodField()

    class Meta:
        model = AlertaAmbiental
        fields = [
            "id",
            "codigo",
            "fonte",
            "id_externo",
            "tipo",
            "geometria",
            "tipo_geometria",
            "src_original",
            "area_ha",
            "data_deteccao",
            "ingerido_em",
            "propriedades",
            "url_origem",
            "bairros",
            "status",
            "transicoes_possiveis",
            "justificativa",
            "referencia",
            "analisado_por",
            "ocorrencia",
            "arvores_proximas",
            "ocorrencias_proximas",
            "area_verde_proxima",
            "atualizado_em",
        ]

    @extend_schema_field(serializers.JSONField())
    def get_geometria(self, obj):
        return json.loads(obj.geom.geojson)

    def get_tipo_geometria(self, obj) -> str:
        return obj.geom.geom_type

    def get_analisado_por(self, obj) -> str | None:
        u = obj.analisado_por
        return (u.nome or u.email) if u else None

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_ocorrencia(self, obj):
        return (
            {"id": str(obj.ocorrencia_id), "codigo": obj.ocorrencia.codigo}
            if obj.ocorrencia_id
            else None
        )

    @extend_schema_field(
        serializers.ListField(child=serializers.ChoiceField(choices=StatusAlerta.choices))
    )
    def get_transicoes_possiveis(self, obj):
        return sorted(TRANSICOES_ALERTA.get(obj.status, set()))


class ArvoreProximaSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    codigo = serializers.CharField()
    especie = serializers.CharField(allow_null=True)
    condicao_aparente = serializers.CharField(allow_blank=True)
    distancia_m = serializers.FloatField(help_text="Distância geodésica em metros.")


class TriagemSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=StatusAlerta.choices)
    justificativa = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    referencia = serializers.CharField(required=False, allow_blank=True, max_length=200)


class StatusEmLoteSerializer(IdsEmLoteSerializer):
    """Novo status para os alertas marcados ou todos os filtrados (M-26).

    Vale a mesma regra da triagem de um alerta: só passa quem tem a transição permitida a
    partir do status atual; os demais ficam como estão, com o motivo. Justificativa e
    referência (quando o status exige) valem para todos.
    """

    motivo = None  # a justificativa faz o papel do motivo no histórico
    status = serializers.ChoiceField(choices=StatusAlerta.choices)
    justificativa = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    referencia = serializers.CharField(required=False, allow_blank=True, max_length=200)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        novo = attrs["status"]
        if novo in EXIGEM_JUSTIFICATIVA and not attrs.get("justificativa", "").strip():
            raise serializers.ValidationError({"justificativa": ["Informe a justificativa."]})
        if novo in EXIGEM_REFERENCIA and not attrs.get("referencia", "").strip():
            raise serializers.ValidationError(
                {"referencia": [f"Informe o {EXIGEM_REFERENCIA[novo]}."]}
            )
        return attrs


class ConversaoSerializer(serializers.Serializer):
    tipo_id = serializers.PrimaryKeyRelatedField(queryset=TipoOcorrencia.objects.filter(ativo=True))
    descricao = serializers.CharField(max_length=4000)


class IngestaoSerializer(serializers.ModelSerializer):
    usuario = serializers.SerializerMethodField()
    # Ingestões antigas gravaram "(DP-11)" na licença: o código não vai ao usuário final.
    licenca = serializers.SerializerMethodField()

    class Meta:
        model = IngestaoAlertas
        fields = [
            "id",
            "fonte",
            "origem",
            "iniciada_em",
            "concluida_em",
            "sucesso",
            "recebidos",
            "novos",
            "ja_existentes",
            "fora_do_municipio",
            "invalidos",
            "erro",
            "orgao",
            "licenca",
            "data_referencia",
            "usuario",
        ]

    def get_usuario(self, obj) -> str | None:
        return (obj.usuario.nome or obj.usuario.email) if obj.usuario else None

    def get_licenca(self, obj) -> str:
        return sem_codigos_internos(obj.licenca)


class FonteEstadoSerializer(serializers.Serializer):
    """Estado de cada fonte externa de alertas: coleta feita e coleta prevista."""

    fonte = serializers.ChoiceField(choices=FonteAlerta.choices)
    rotulo = serializers.CharField()
    automatica = serializers.BooleanField(
        help_text="A fonte tem URL em ALERTAS_FONTES e é coletada pelo agendador."
    )
    intervalo_horas = serializers.IntegerField(allow_null=True)
    ultima_coleta = serializers.DateTimeField(
        allow_null=True, help_text="Início da última execução, automática ou manual."
    )
    ultima_coleta_sucesso = serializers.BooleanField(allow_null=True)
    proxima_coleta = serializers.DateTimeField(
        allow_null=True,
        help_text=(
            "Última coleta automática mais o intervalo configurado. Nulo se a fonte não é "
            "automática ou se o agendador ainda não a executou."
        ),
    )


class NovaIngestaoSerializer(serializers.Serializer):
    fonte = serializers.ChoiceField(choices=FonteAlerta.choices)
    arquivo = serializers.FileField()


FILTROS = [
    OpenApiParameter(
        "status", str, description="'abertos' (não finais, padrão), 'todos' ou lista."
    ),
    OpenApiParameter("fonte", str),
    OpenApiParameter("tipo", str),
    OpenApiParameter("bairro", str),
    OpenApiParameter("deteccao_desde", str, description="AAAA-MM-DD"),
    OpenApiParameter("deteccao_ate", str, description="AAAA-MM-DD"),
    OpenApiParameter("ingestao_desde", str, description="AAAA-MM-DD"),
    OpenApiParameter(
        "ordem",
        str,
        description=(
            "'-data_deteccao' (padrão), 'data_deteccao', 'arvores_proximas', "
            "'-arvores_proximas', 'ocorrencias_proximas' ou '-ocorrencias_proximas'."
        ),
    ),
]
PARAMETRO_RAIO = OpenApiParameter(
    "raio", int, description="Raio, em metros, das árvores e ocorrências próximas (1 a 1000; 100)."
)


def filtrar_por_bairro(qs, bairro):
    """Alertas cuja geometria intersecta o bairro (``bairros`` é gravado na ingestão)."""
    if not bairro:
        return qs
    return qs.filter(bairros__contains=[{"id": str(uuid_do_parametro(bairro, "bairro"))}])


def filtrar_alertas(qs, p):
    """Filtros da listagem de alertas, compartilhados com a exportação."""
    situacao = p.get("status", "abertos")
    if situacao == "abertos":
        qs = qs.exclude(status__in=FINAIS_ALERTA)
    elif situacao != "todos":
        qs = qs.filter(status__in=situacao.split(","))
    for campo in ("fonte", "tipo"):
        if valor := p.get(campo):
            qs = qs.filter(**{campo: valor})
    qs = filtrar_por_bairro(qs, p.get("bairro"))
    if v := p.get("deteccao_desde"):
        qs = qs.filter(data_deteccao__date__gte=v)
    if v := p.get("deteccao_ate"):
        qs = qs.filter(data_deteccao__date__lte=v)
    if v := p.get("ingestao_desde"):
        qs = qs.filter(ingerido_em__date__gte=v)
    return qs


ORDENS = {
    "data_deteccao": ("data_deteccao", "numero"),
    "-data_deteccao": ("-data_deteccao", "-numero"),
    "arvores_proximas": ("arvores_proximas", "-data_deteccao"),
    "-arvores_proximas": ("-arvores_proximas", "-data_deteccao"),
    "ocorrencias_proximas": ("ocorrencias_proximas", "-data_deteccao"),
    "-ocorrencias_proximas": ("-ocorrencias_proximas", "-data_deteccao"),
}


@extend_schema_view(
    list=extend_schema(operation_id="alertas_listar", parameters=[*FILTROS, PARAMETRO_RAIO]),
    retrieve=extend_schema(operation_id="alertas_obter", parameters=[PARAMETRO_RAIO]),
)
class AlertaViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Alertas ambientais para triagem humana (W-08). Separados das ocorrências."""

    serializer_class = AlertaSerializer
    lookup_value_converter = "uuid"

    def get_permissions(self):
        if self.action in ("triagem", "converter", "status_em_lote"):
            return [requer(P.ALERTAS_TRIAR)()]
        if self.action in ("ingestoes", "estado_fontes", "enviar_arquivo"):
            return (
                [requer(P.ADMIN_CONFIGURACAO)()]
                if self.request.method == "POST"
                else [requer(P.ALERTAS_LER)()]
            )
        return [requer(P.ALERTAS_LER)()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return AlertaAmbiental.objects.none()
        qs = filtrar_alertas_por_escopo(
            AlertaAmbiental.objects.select_related("analisado_por", "ocorrencia"), self.request.user
        )
        p = self.request.query_params
        try:
            raio = proximidade.normalizar_raio(p.get("raio"))
        except ValueError as e:
            raise ValidationError({"raio": [str(e)]}) from None
        qs = proximidade.anotar_contagens(qs, self.request.user, raio)
        if self.action != "list":
            return qs
        qs = filtrar_alertas(qs, p)
        ordem = p.get("ordem", "-data_deteccao")
        if ordem not in ORDENS:
            raise ValidationError({"ordem": ["Ordenação inválida."]})
        return qs.order_by(*ORDENS[ordem])

    @extend_schema(
        operation_id="alertas_arvores_proximas",
        parameters=[PARAMETRO_RAIO],
        responses=ArvoreProximaSerializer(many=True),
    )
    @action(detail=True, url_path="arvores-proximas", pagination_class=None)
    def arvores_proximas(self, request, pk=None):
        """Árvores no escopo a até `raio` m do alerta, da mais próxima à mais distante."""
        alerta = self.get_object()
        raio = proximidade.normalizar_raio(request.query_params.get("raio"))
        arvores = proximidade.arvores_do_raio(request.user, alerta.geom, raio).select_related(
            "especie"
        )[:200]
        return Response(
            ArvoreProximaSerializer(
                [
                    {
                        "id": a.id,
                        "codigo": a.codigo,
                        "especie": (
                            a.especie.nomes_comuns[0]
                            if a.especie.nomes_comuns
                            else a.especie.nome_cientifico
                        )
                        if a.especie_id
                        else None,
                        "condicao_aparente": a.condicao_aparente,
                        "distancia_m": round(a.distancia_m, 1),
                    }
                    for a in arvores
                ],
                many=True,
            ).data
        )

    @extend_schema(
        operation_id="alertas_triagem", request=TriagemSerializer, responses=AlertaSerializer
    )
    @action(detail=True, methods=["post"])
    def triagem(self, request, pk=None):
        """Muda o status com justificativa. Nenhum status afirma infração antes da
        confirmação formal da autoridade, que exige referência ao documento."""
        alerta = self.get_object()
        dados = TriagemSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        novo = dados.validated_data["status"]
        justificativa = dados.validated_data.get("justificativa", "").strip()
        referencia = dados.validated_data.get("referencia", "").strip()
        if novo not in TRANSICOES_ALERTA.get(alerta.status, set()):
            raise ValidationError({"status": ["Transição não permitida a partir do status atual."]})
        if novo in EXIGEM_JUSTIFICATIVA and not justificativa:
            raise ValidationError({"justificativa": ["Informe a justificativa."]})
        if novo in EXIGEM_REFERENCIA and not referencia:
            raise ValidationError({"referencia": [f"Informe o {EXIGEM_REFERENCIA[novo]}."]})
        with pghistory.context(motivo=justificativa or None):
            alerta.status = novo
            alerta.justificativa = justificativa
            if referencia:
                alerta.referencia = referencia
            alerta.analisado_por = request.user
            alerta.save(
                update_fields=[
                    "status",
                    "justificativa",
                    "referencia",
                    "analisado_por",
                    "atualizado_em",
                ]
            )
        return Response(AlertaSerializer(alerta).data)

    @extend_schema(
        operation_id="alertas_status_em_lote",
        request=StatusEmLoteSerializer,
        responses={200: ResultadoAcaoEmLoteSerializer, 202: OperacaoEmLoteSerializer},
    )
    @action(detail=False, methods=["post"], url_path="lote/status", pagination_class=None)
    def status_em_lote(self, request):
        """Muda o status dos alertas marcados ou de todos os filtrados, respeitando as
        transições permitidas. Com mais de 200 alertas, roda em segundo plano."""
        dados = StatusEmLoteSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        v = dados.validated_data
        justificativa = v.get("justificativa", "").strip()
        v["motivo"] = justificativa
        parametros = {
            "status": v["status"],
            "justificativa": justificativa,
            "referencia": v.get("referencia", "").strip(),
        }
        return iniciar_acao_em_lote(request.user, "alertas", "status", v, parametros)

    @extend_schema(
        operation_id="alertas_converter_ocorrencia",
        request=ConversaoSerializer,
        responses=AlertaSerializer,
    )
    @action(detail=True, methods=["post"], url_path="converter-ocorrencia")
    def converter(self, request, pk=None):
        """Converte o alerta em ocorrência (RF-ALR-006), mantendo o vínculo."""
        if not request.user.tem_permissao(P.OCORRENCIAS_EDITAR):
            raise ValidationError("Você não pode registrar ocorrências.")
        alerta = self.get_object()
        if alerta.ocorrencia_id:
            raise ValidationError("Este alerta já foi convertido em ocorrência.")
        if alerta.status in FINAIS_ALERTA:
            raise ValidationError("Alertas encerrados não são convertidos.")
        dados = ConversaoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        with (
            transaction.atomic(),
            pghistory.context(evento="conversao_alerta", alerta=alerta.codigo),
        ):
            ocorrencia = Ocorrencia.objects.create(
                tipo=dados.validated_data["tipo_id"],
                geom=alerta.geom.point_on_surface,
                descricao=dados.validated_data["descricao"],
                condicao_aparente=(
                    f"Sinal remoto: {alerta.get_tipo_display()} ({alerta.get_fonte_display()})."
                ),
                origem=OrigemOcorrencia.ALERTA,
                origem_referencia=alerta.codigo,
                registrada_por=request.user,
            )
            alerta.ocorrencia = ocorrencia
            alerta.save(update_fields=["ocorrencia", "atualizado_em"])
        return Response(AlertaSerializer(alerta).data)

    @extend_schema(operation_id="alertas_historico", responses=EventoAuditoriaSerializer(many=True))
    @action(detail=True, pagination_class=None)
    def historico(self, request, pk=None):
        eventos = Events.objects.references(self.get_object()).order_by(
            "-pgh_created_at", "-pgh_id"
        )[:500]
        return Response(EventoAuditoriaSerializer(eventos, many=True).data)

    @extend_schema(operation_id="alertas_ingestoes", responses=IngestaoSerializer(many=True))
    @action(detail=False, pagination_class=None)
    def ingestoes(self, request):
        """Últimas execuções por fonte: estado das integrações (RF-ADM-006)."""
        return Response(
            IngestaoSerializer(
                IngestaoAlertas.objects.select_related("usuario")[:50], many=True
            ).data
        )

    @extend_schema(operation_id="alertas_fontes", responses=FonteEstadoSerializer(many=True))
    @action(detail=False, url_path="fontes", pagination_class=None)
    def estado_fontes(self, request):
        """Última coleta e próxima coleta de cada fonte, pelo agendamento configurado."""
        intervalo = timedelta(hours=settings.ALERTAS_INTERVALO_HORAS)
        configuradas = set(settings.ALERTAS_FONTES or {})
        resultado = []
        for fonte, rotulo in FonteAlerta.choices:
            execucoes = IngestaoAlertas.objects.filter(fonte=fonte)
            ultima = execucoes.order_by("-iniciada_em").first()
            automatica = fonte in configuradas
            ultima_auto = (
                execucoes.filter(usuario__isnull=True).order_by("-iniciada_em").first()
                if automatica
                else None
            )
            resultado.append(
                {
                    "fonte": fonte,
                    "rotulo": rotulo,
                    "automatica": automatica,
                    "intervalo_horas": settings.ALERTAS_INTERVALO_HORAS if automatica else None,
                    "ultima_coleta": ultima.iniciada_em if ultima else None,
                    "ultima_coleta_sucesso": ultima.sucesso if ultima else None,
                    "proxima_coleta": ultima_auto.iniciada_em + intervalo if ultima_auto else None,
                }
            )
        return Response(FonteEstadoSerializer(resultado, many=True).data)

    @extend_schema(
        operation_id="alertas_enviar_arquivo",
        request={"multipart/form-data": NovaIngestaoSerializer},
        responses={201: IngestaoSerializer},
    )
    @action(
        detail=False,
        methods=["post"],
        url_path="ingestoes/arquivo",
        parser_classes=[MultiPartParser],
        pagination_class=None,
    )
    def enviar_arquivo(self, request):
        """Ingestão manual de um arquivo baixado da fonte (CSV do BDQueimadas ou GeoJSON)."""
        dados = NovaIngestaoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        arquivo = dados.validated_data["arquivo"]
        ingestao = fontes.ingerir(
            dados.validated_data["fonte"], arquivo.read(), arquivo.name, request.user
        )
        return Response(IngestaoSerializer(ingestao).data, status=status.HTTP_201_CREATED)


# Geometrias para o mapa (polígonos e pontos), com escopo.
def alertas_geojson(usuario, params) -> dict:
    qs = filtrar_alertas_por_escopo(
        AlertaAmbiental.objects.exclude(status__in=FINAIS_ALERTA), usuario
    )
    qs = filtrar_por_bairro(qs, params.get("bairro"))
    qs = qs.annotate(g=AsGeoJSON("geom", precision=6))[:5000]
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": str(a.id),
                "geometry": json.loads(a.g),
                "properties": {
                    "codigo": a.codigo,
                    "fonte": a.fonte,
                    "tipo": a.tipo,
                    "status": a.status,
                    "data_deteccao": a.data_deteccao.isoformat(),
                },
            }
            for a in qs
        ],
    }
