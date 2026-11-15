import json

from django.contrib.gis.db.models.functions import AsGeoJSON
from django.contrib.gis.geos import Polygon
from django.db.models import Exists, OuterRef
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from itree.contas.acesso import filtrar_por_escopo, requer

from .cnuc import chave_da_uc
from .models import (
    AdocaoPraca,
    AreaVerde,
    SubtipoAreaVerde,
    TipoAdotante,
    TipoAreaVerde,
)
from .servico import situacao_da_fonte

PARAMETROS = [
    OpenApiParameter("tipo", str, description="praca | parque | unidade_conservacao"),
    OpenApiParameter(
        "subtipo",
        str,
        description="Só das praças: praca | areninha | calcadao | rotatoria | sem_denominacao.",
    ),
    OpenApiParameter(
        "adotada",
        str,
        description="1 devolve só as praças com adoção (mapa 622 do Fortaleza em Mapas).",
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


def _adocoes_por_area(ids=None) -> dict:
    """Por praça: quantas adoções, categorias de adotante (sem nome) e ano de referência.

    Só vêm da adoção os campos que não identificam pessoa (ver ``adocao``)."""
    adocoes = AdocaoPraca.objects.filter(area_verde__isnull=False)
    if ids is not None:
        adocoes = adocoes.filter(area_verde_id__in=ids)
    por_area: dict = {}
    for area_id, tipo, ano in adocoes.values_list(
        "area_verde_id", "tipo_adotante", "ano_referencia"
    ):
        dados = por_area.setdefault(area_id, {"n": 0, "tipos": set(), "ano": ano})
        dados["n"] += 1
        if tipo != TipoAdotante.NAO_CLASSIFICADO:
            dados["tipos"].add(tipo)
        dados["ano"] = max(filter(None, [dados["ano"], ano]), default=None)
    return por_area


def _feicao(a: AreaVerde, grupos: dict[str, tuple[int, float | None]], adocoes: dict) -> dict:
    adocao = adocoes.get(a.id)
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
            # Adoção de praça (mapa 622): só a existência, a quantidade, a categoria do adotante
            # (sem nome) e o ano de referência do mapa. A fonte não traz a data do termo.
            "adotada": adocao is not None,
            "adocoes": adocao["n"] if adocao else 0,
            "adocao_tipos": sorted(TipoAdotante(t).label for t in adocao["tipos"])
            if adocao
            else [],
            "adocao_ano_referencia": adocao["ano"] if adocao else None,
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
        parameters=[PARAMETROS[4]],
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
        if params.get("adotada") == "1":
            qs = qs.filter(Exists(AdocaoPraca.objects.filter(area_verde=OuterRef("pk"))))
        if bbox := params.get("bbox"):
            qs = qs.filter(geom__intersects=_bbox(bbox))
        return qs.annotate(geometria=AsGeoJSON("geom", precision=self._precisao()))

    def list(self, request: Request, *args, **kwargs) -> Response:
        """FeatureCollection com fonte, licença e datas em cada feição (RN-PROV-003)."""
        grupos = _grupos_de_unidades(request.user)
        areas = list(self.get_queryset())
        adocoes = _adocoes_por_area({a.id for a in areas})
        feicoes = [_feicao(a, grupos, adocoes) for a in areas]
        return Response(
            {
                "type": "FeatureCollection",
                "features": feicoes,
                # Última importação e aviso de fonte desatualizada (RF-INT-005).
                "situacao_da_fonte": situacao_da_fonte(),
            }
        )

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        area = self.get_object()
        return Response(
            _feicao(area, _grupos_de_unidades(request.user), _adocoes_por_area({area.id}))
        )
