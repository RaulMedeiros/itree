import json

from django.contrib.gis.db.models.functions import AsGeoJSON
from django.contrib.gis.geos import Polygon
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from itree.contas.acesso import filtrar_por_escopo, requer

from .models import AreaVerde, TipoAreaVerde

PARAMETROS = [
    OpenApiParameter("tipo", str, description="praca | parque | unidade_conservacao"),
    OpenApiParameter("bbox", str, description="Limites oeste,sul,leste,norte em graus (WGS 84)."),
    OpenApiParameter("precisao", int, description="Casas decimais da geometria (padrão 5)."),
]
GEOJSON = {(200, "application/geo+json"): OpenApiTypes.OBJECT}


def _bbox(texto: str) -> Polygon:
    try:
        oeste, sul, leste, norte = (float(v) for v in texto.split(","))
    except ValueError:
        raise ValidationError({"bbox": "Use oeste,sul,leste,norte, em graus."}) from None
    if not (-180 <= oeste <= leste <= 180 and -90 <= sul <= norte <= 90):
        raise ValidationError({"bbox": "Limites fora do intervalo ou invertidos."})
    caixa = Polygon.from_bbox((oeste, sul, leste, norte))
    caixa.srid = 4326
    return caixa


def _feicao(a: AreaVerde) -> dict:
    return {
        "type": "Feature",
        "id": str(a.id),
        "geometry": json.loads(a.geometria),
        "properties": {
            "nome": a.nome,
            "nome_popular": a.nome_popular,
            "tipo": a.tipo,
            "tipo_rotulo": a.get_tipo_display(),
            "codigo_externo": a.codigo_externo,
            "orgao_gestor": a.orgao_gestor,
            "esfera": a.esfera,
            "ato_legal": a.ato_legal,
            "area_m2": a.area_m2,
            "fonte": a.fonte,
            "fonte_url": a.fonte_url,
            "licenca": a.licenca,
            "data_referencia": a.data_referencia,
            "ingerido_em": a.ingerido_em,
        },
    }


@extend_schema_view(
    list=extend_schema(
        operation_id="areas_verdes_listar", parameters=PARAMETROS, responses=GEOJSON
    ),
    retrieve=extend_schema(
        operation_id="areas_verdes_obter",
        parameters=[PARAMETROS[2]],
        responses=GEOJSON,
    ),
)
class AreaVerdeViewSet(viewsets.ReadOnlyModelViewSet):
    """Praças, parques e unidades de conservação em GeoJSON, somente leitura.

    Exige permissão de leitura do mapa e respeita o escopo territorial: só
    aparece o que intersecta a área do usuário (RF-ACL-003).
    """

    permission_classes = [requer("mapa.ler")]
    pagination_class = None

    def _precisao(self) -> int:
        try:
            return min(max(int(self.request.query_params.get("precisao", 5)), 1), 8)
        except ValueError:
            return 5

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # geração do contrato OpenAPI
            return AreaVerde.objects.none()
        qs = filtrar_por_escopo(AreaVerde.objects.all(), self.request.user)
        params = self.request.query_params
        if tipo := params.get("tipo"):
            if tipo not in TipoAreaVerde.values:
                raise ValidationError({"tipo": f"Use um de: {', '.join(TipoAreaVerde.values)}."})
            qs = qs.filter(tipo=tipo)
        if bbox := params.get("bbox"):
            qs = qs.filter(geom__intersects=_bbox(bbox))
        return qs.annotate(geometria=AsGeoJSON("geom", precision=self._precisao()))

    def list(self, request: Request, *args, **kwargs) -> Response:
        """FeatureCollection com fonte, licença e datas em cada feição (RN-PROV-003)."""
        feicoes = [_feicao(a) for a in self.get_queryset()]
        return Response({"type": "FeatureCollection", "features": feicoes})

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        return Response(_feicao(self.get_object()))
