import json

from django.contrib.gis.db.models.functions import AsGeoJSON
from django.db.models import Count, Max, Q
from django.http import Http404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from itree.contas.acesso import requer
from itree.contas.permissoes import Permissao as P

from . import servico, tasks
from .models import Conector, DestinoConector, ExecucaoConector
from .seguranca import ErroConector
from .serializers import (
    CamadaReferenciaSerializer,
    ConectorSerializer,
    ExecucaoConectorSerializer,
    ResultadoTesteSerializer,
    TestarConectorSerializer,
)


@extend_schema_view(
    list=extend_schema(operation_id="conectores_listar"),
    retrieve=extend_schema(operation_id="conectores_obter"),
    create=extend_schema(operation_id="conectores_criar"),
    partial_update=extend_schema(operation_id="conectores_atualizar"),
)
class ConectorViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Conectores de fontes externas (RF-INT-006). Tudo exige ``admin.configuracao``."""

    permission_classes = [requer(P.ADMIN_CONFIGURACAO)]
    serializer_class = ConectorSerializer
    pagination_class = None
    lookup_value_converter = "uuid"
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Conector.objects.none()
        return Conector.objects.select_related("modelo_importacao").annotate(
            total_feicoes=Count("feicoes")
        )

    def perform_create(self, serializer):
        serializer.save(criado_por=self.request.user)

    @extend_schema(
        operation_id="conectores_testar",
        request=TestarConectorSerializer,
        responses=ResultadoTesteSerializer,
    )
    @action(detail=False, methods=["post"])
    def testar(self, request: Request) -> Response:
        """Busca a fonte sem gravar nada: quantas feições e as primeiras colunas."""
        dados = TestarConectorSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        try:
            resultado = servico.testar(
                dados.validated_data["tipo"],
                dados.validated_data["url"],
                dados.validated_data.get("parametros", {}),
            )
        except ErroConector as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(ResultadoTesteSerializer(resultado).data)

    @extend_schema(
        operation_id="conectores_sincronizar",
        request=None,
        responses={202: ExecucaoConectorSerializer},
    )
    @action(detail=True, methods=["post"])
    def sincronizar(self, request: Request, pk=None) -> Response:
        """Abre a execução e a coloca na fila; o histórico mostra o resultado."""
        conector = self.get_object()
        try:
            execucao = servico.iniciar_execucao(conector, usuario=request.user)
        except servico.ExecucaoEmAndamento:
            return Response(
                {"detail": "Já há uma sincronização em andamento para este conector."},
                status=status.HTTP_409_CONFLICT,
            )
        tasks.enfileirar(execucao)
        execucao.refresh_from_db()
        return Response(ExecucaoConectorSerializer(execucao).data, status=status.HTTP_202_ACCEPTED)

    @extend_schema(
        operation_id="conectores_execucoes", responses=ExecucaoConectorSerializer(many=True)
    )
    @action(detail=True, methods=["get"], pagination_class=None)
    def execucoes(self, request: Request, pk=None) -> Response:
        """Histórico do conector, da mais recente para a mais antiga (últimas 100)."""
        conector = self.get_object()
        qs = ExecucaoConector.objects.filter(conector=conector).select_related("usuario", "lote")
        return Response(ExecucaoConectorSerializer(qs[:100], many=True).data)


# ---------------------------------------------------------------------------------------------
# Camadas de referência no mapa
# ---------------------------------------------------------------------------------------------


@extend_schema(
    operation_id="mapa_camadas_referencia", responses=CamadaReferenciaSerializer(many=True)
)
@api_view(["GET"])
@permission_classes([requer("mapa.ler")])
def camadas_referencia(request: Request) -> Response:
    """Camadas de referência ativas, com fonte, licença e data, para o painel de camadas."""
    qs = (
        Conector.objects.filter(ativo=True, destino=DestinoConector.CAMADA_REFERENCIA)
        .annotate(
            total=Count("feicoes"),
            atualizada_em=Max("execucoes__concluida_em", filter=Q(execucoes__sucesso=True)),
        )
        .order_by("nome")
    )
    return Response(CamadaReferenciaSerializer(qs, many=True).data)


@extend_schema(
    operation_id="mapa_camada_referencia",
    parameters=[OpenApiParameter("precisao", int, description="Casas decimais (padrão 5).")],
    responses={(200, "application/geo+json"): OpenApiTypes.OBJECT},
)
@api_view(["GET"])
@permission_classes([requer("mapa.ler")])
def camada_referencia(request: Request, pk) -> Response:
    """Feições de uma camada de referência ativa, como GeoJSON. São dados públicos de contexto,
    sem filtro territorial; só camadas ativas são servidas."""
    conector = Conector.objects.filter(
        pk=pk, ativo=True, destino=DestinoConector.CAMADA_REFERENCIA
    ).first()
    if conector is None:
        raise Http404
    try:
        precisao = min(max(int(request.query_params.get("precisao", 5)), 1), 8)
    except ValueError:
        precisao = 5
    feicoes = [
        {
            "type": "Feature",
            "id": f["id_externo"],
            "geometry": json.loads(f["geometria"]),
            "properties": f["propriedades"],
        }
        for f in conector.feicoes.annotate(geometria=AsGeoJSON("geom", precision=precisao))
        .values("id_externo", "geometria", "propriedades")
        .order_by("id_externo")
    ]
    return Response({"type": "FeatureCollection", "features": feicoes})
