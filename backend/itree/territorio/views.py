import json

from django.contrib.gis.db.models.functions import AsGeoJSON
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from .models import Territorio
from .serializers import TerritorioSerializer

PARAMETROS = [
    OpenApiParameter("tipo", str, description="municipio | regional | bairro"),
    OpenApiParameter("busca", str, description="Parte do nome."),
]


@extend_schema_view(
    list=extend_schema(operation_id="territorios_listar", parameters=PARAMETROS),
    retrieve=extend_schema(operation_id="territorios_obter"),
)
class TerritorioViewSet(viewsets.ReadOnlyModelViewSet):
    """Limites territoriais. São dados públicos de referência: qualquer usuário
    autenticado pode consultá-los, independentemente do escopo."""

    serializer_class = TerritorioSerializer

    def get_queryset(self):
        qs = Territorio.objects.select_related("pai")
        if tipo := self.request.query_params.get("tipo"):
            qs = qs.filter(tipo=tipo)
        if busca := self.request.query_params.get("busca"):
            qs = qs.filter(nome__icontains=busca)
        return qs

    @extend_schema(
        operation_id="territorios_geojson",
        parameters=[
            *PARAMETROS,
            OpenApiParameter("precisao", int, description="Casas decimais (padrão 6)."),
        ],
        responses={(200, "application/geo+json"): OpenApiTypes.OBJECT},
    )
    @action(detail=False, pagination_class=None)
    def geojson(self, request: Request) -> Response:
        """FeatureCollection com fonte e data em cada feição (RN-PROV-003)."""
        try:
            precisao = min(max(int(request.query_params.get("precisao", 6)), 1), 8)
        except ValueError:
            precisao = 6
        qs = self.get_queryset().annotate(geometria=AsGeoJSON("geom", precision=precisao))
        feicoes = [
            {
                "type": "Feature",
                "id": str(t.id),
                "geometry": json.loads(t.geometria),
                "properties": {
                    "nome": t.nome,
                    "tipo": t.tipo,
                    "codigo": t.codigo,
                    "fonte": t.fonte,
                    "fonte_url": t.fonte_url,
                    "data_referencia": t.data_referencia,
                    "ingerido_em": t.ingerido_em,
                },
            }
            for t in qs
        ]
        return Response({"type": "FeatureCollection", "features": feicoes})
