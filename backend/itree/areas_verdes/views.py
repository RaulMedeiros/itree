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

from .cnuc import chave_da_uc
from .models import AreaVerde, SubtipoAreaVerde, TipoAreaVerde
from .servico import situacao_da_fonte

PARAMETROS = [
    OpenApiParameter("tipo", str, description="praca | parque | unidade_conservacao"),
    OpenApiParameter(
        "subtipo",
        str,
        description="Só das praças: praca | areninha | calcadao | rotatoria | sem_denominacao.",
    ),
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


def _grupos_de_unidades(usuario) -> dict[str, tuple[int, float | None]]:
    """Feições e área somada de cada unidade de conservação visível para ``usuario``.

    A API da prefeitura repete a mesma unidade em várias feições (a APA do Estuário do Rio
    Ceará tem 4; o Parque Estadual Marinho, 3 zonas). A chave é o código do CNUC, quando
    há, ou o nome normalizado sem o sufixo de zona."""
    grupos: dict[str, list] = {}
    unidades = filtrar_por_escopo(
        AreaVerde.objects.filter(tipo=TipoAreaVerde.UNIDADE_CONSERVACAO), usuario
    )
    for nome, codigo, area in unidades.values_list("nome", "codigo_cnuc", "area_m2"):
        grupo = grupos.setdefault(codigo or chave_da_uc(nome), [0, None])
        grupo[0] += 1
        if area is not None:
            grupo[1] = (grupo[1] or 0) + area
    return {
        chave: (n, None if total is None else round(total, 2))
        for chave, (n, total) in grupos.items()
    }


def _feicao(a: AreaVerde, grupos: dict[str, tuple[int, float | None]]) -> dict:
    unidade = grupos.get(a.codigo_cnuc or chave_da_uc(a.nome))
    if a.tipo != TipoAreaVerde.UNIDADE_CONSERVACAO:
        unidade = None
    return {
        "type": "Feature",
        "id": str(a.id),
        "geometry": json.loads(a.geometria),
        "properties": {
            "nome": a.nome,
            "nome_popular": a.nome_popular,
            "tipo": a.tipo,
            "tipo_rotulo": a.get_tipo_display(),
            "subtipo": a.subtipo,
            "subtipo_rotulo": a.get_subtipo_display(),
            "codigo_externo": a.codigo_externo,
            "orgao_gestor": a.orgao_gestor,
            "esfera": a.esfera,
            "codigo_cnuc": a.codigo_cnuc,
            "esfera_cnuc": a.esfera_cnuc,
            "ato_legal": a.ato_legal,
            "area_m2": a.area_m2,
            # Só nas unidades de conservação: feições da mesma unidade e a área somada delas.
            "feicoes_da_unidade": unidade[0] if unidade else None,
            "area_total_da_unidade_m2": unidade[1] if unidade else None,
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
        parameters=[PARAMETROS[3]],
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
        if subtipo := params.get("subtipo"):
            if subtipo not in SubtipoAreaVerde.values:
                raise ValidationError(
                    {"subtipo": f"Use um de: {', '.join(SubtipoAreaVerde.values)}."}
                )
            qs = qs.filter(subtipo=subtipo)
        if bbox := params.get("bbox"):
            qs = qs.filter(geom__intersects=_bbox(bbox))
        return qs.annotate(geometria=AsGeoJSON("geom", precision=self._precisao()))

    def list(self, request: Request, *args, **kwargs) -> Response:
        """FeatureCollection com fonte, licença e datas em cada feição (RN-PROV-003)."""
        grupos = _grupos_de_unidades(request.user)
        feicoes = [_feicao(a, grupos) for a in self.get_queryset()]
        return Response(
            {
                "type": "FeatureCollection",
                "features": feicoes,
                # Última importação e aviso de fonte desatualizada (RF-INT-005).
                "situacao_da_fonte": situacao_da_fonte(),
            }
        )

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        return Response(_feicao(self.get_object(), _grupos_de_unidades(request.user)))
