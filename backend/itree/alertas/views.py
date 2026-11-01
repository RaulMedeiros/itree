import json

import pghistory
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
from itree.contas.acesso import filtrar_por_escopo, requer
from itree.contas.permissoes import Permissao
from itree.core.parametros import uuid_do_parametro
from itree.ocorrencias.models import Ocorrencia, OrigemOcorrencia, TipoOcorrencia

from . import fontes
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


class TriagemSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=StatusAlerta.choices)
    justificativa = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    referencia = serializers.CharField(required=False, allow_blank=True, max_length=200)


class ConversaoSerializer(serializers.Serializer):
    tipo_id = serializers.PrimaryKeyRelatedField(queryset=TipoOcorrencia.objects.filter(ativo=True))
    descricao = serializers.CharField(max_length=4000)


class IngestaoSerializer(serializers.ModelSerializer):
    usuario = serializers.SerializerMethodField()

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
            "usuario",
        ]

    def get_usuario(self, obj) -> str | None:
        return (obj.usuario.nome or obj.usuario.email) if obj.usuario else None


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
]


@extend_schema_view(
    list=extend_schema(operation_id="alertas_listar", parameters=FILTROS),
    retrieve=extend_schema(operation_id="alertas_obter"),
)
class AlertaViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Alertas ambientais para triagem humana (W-08). Separados das ocorrências."""

    serializer_class = AlertaSerializer
    lookup_value_converter = "uuid"

    def get_permissions(self):
        if self.action in ("triagem", "converter"):
            return [requer(P.ALERTAS_TRIAR)()]
        if self.action in ("ingestoes", "enviar_arquivo"):
            return (
                [requer(P.ADMIN_CONFIGURACAO)()]
                if self.request.method == "POST"
                else [requer(P.ALERTAS_LER)()]
            )
        return [requer(P.ALERTAS_LER)()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return AlertaAmbiental.objects.none()
        qs = filtrar_por_escopo(
            AlertaAmbiental.objects.select_related("analisado_por", "ocorrencia"), self.request.user
        )
        if self.action != "list":
            return qs
        p = self.request.query_params
        situacao = p.get("status", "abertos")
        if situacao == "abertos":
            qs = qs.exclude(status__in=FINAIS_ALERTA)
        elif situacao != "todos":
            qs = qs.filter(status__in=situacao.split(","))
        for campo in ("fonte", "tipo"):
            if valor := p.get(campo):
                qs = qs.filter(**{campo: valor})
        if bairro := p.get("bairro"):
            qs = qs.filter(bairros__contains=[{"id": str(uuid_do_parametro(bairro, "bairro"))}])
        if v := p.get("deteccao_desde"):
            qs = qs.filter(data_deteccao__date__gte=v)
        if v := p.get("deteccao_ate"):
            qs = qs.filter(data_deteccao__date__lte=v)
        if v := p.get("ingestao_desde"):
            qs = qs.filter(ingerido_em__date__gte=v)
        return qs

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
    qs = filtrar_por_escopo(AlertaAmbiental.objects.exclude(status__in=FINAIS_ALERTA), usuario)
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
