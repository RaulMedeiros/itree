"""PRODES Caatinga: supressão anual de vegetação como camada de referência (F-02).

Lê o WFS do TerraBrasilis (``prodes-caatinga-nb:yearly_deforestation``), recorta pelo município
cadastrado ampliado por um buffer configurável e grava ``SupressaoAnual``. **Não cria alerta**:
o PRODES é um mapeamento anual, de escala regional e polígonos de cerca de 1 ha ou mais, sem
data de evento (só a da imagem). Serve de contexto histórico, nunca de triagem.
"""

import time
from dataclasses import dataclass

import requests
from django.conf import settings
from django.contrib.gis.gdal import CoordTransform, SpatialReference
from django.contrib.gis.geos import MultiPolygon
from django.utils import timezone

from itree.core.geo import SRID_METRICO, ampliar
from itree.territorio.models import Territorio, TipoTerritorio

from .fontes import ErroFonte, ler_geojson
from .models import SupressaoAnual

FONTE_LEITURA = "inpe_prodes_caatinga"
URL_WFS = "https://terrabrasilis.dpi.inpe.br/geoserver/wfs"
CAMADA_WFS = "prodes-caatinga-nb:yearly_deforestation"
URL_PAGINA = "https://terrabrasilis.dpi.inpe.br/app/map/deforestation?hr=false&bm=caatinga"
FONTE = "INPE, TerraBrasilis (PRODES Caatinga)"
LICENCA = (
    "Não declarada para os dados (o WMS informa Fees e AccessConstraints como 'none'). "
    "Condições de uso em definição pela prefeitura. Citar: INPE, TerraBrasilis, PRODES Caatinga."
)
ESCALA = "polígonos de cerca de 1 ha ou mais, leitura anual, escala regional"


@dataclass
class ResumoIngestao:
    recebidos: int = 0
    novos: int = 0
    atualizados: int = 0
    fora_do_recorte: int = 0
    invalidos: int = 0


def recorte(buffer_km: float | None = None):
    """Município cadastrado ampliado pelo buffer (km), em 4326."""
    municipio = (
        Territorio.objects.filter(tipo=TipoTerritorio.MUNICIPIO)
        .values_list("geom", flat=True)
        .first()
    )
    if municipio is None:
        raise ErroFonte("Nenhum município cadastrado: importe os territórios antes.")
    km = settings.PRODES_CAATINGA_BUFFER_KM if buffer_km is None else buffer_km
    return ampliar(municipio, km * 1000)


def url_do_recorte(area) -> str:
    """URL do WFS com o retângulo da área (WFS 2.0: latitude antes de longitude)."""
    oeste, sul, leste, norte = area.extent
    bbox = f"{sul},{oeste},{norte},{leste},urn:ogc:def:crs:EPSG::4326"
    return (
        f"{URL_WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames={CAMADA_WFS}"
        f"&outputFormat=application/json&srsName=EPSG:4326&bbox={bbox}"
    )


def baixar(url: str, tentativas: int = 4, espera: float = 15) -> bytes:
    """Baixa o GeoJSON. O servidor do INPE responde 503 quando sobrecarregado: repete."""
    timeout = max(getattr(settings, "ALERTAS_TIMEOUT", 60), 120)
    for i in range(tentativas):
        resposta = requests.get(url, timeout=timeout)
        if resposta.status_code in (502, 503, 504) and i < tentativas - 1:
            time.sleep(espera)
            continue
        resposta.raise_for_status()
        return resposta.content
    raise ErroFonte("O servidor do TerraBrasilis não respondeu.")  # inalcançável


def ingerir(conteudo: bytes, area, origem: str = URL_PAGINA) -> ResumoIngestao:
    """Grava os polígonos que intersectam ``area``; idempotente pelo identificador da fonte."""
    registros, invalidos = ler_geojson(conteudo, FONTE_LEITURA)
    resumo = ResumoIngestao(recebidos=len(registros) + invalidos, invalidos=invalidos)
    metrica = CoordTransform(SpatialReference(4326), SpatialReference(SRID_METRICO))
    agora = timezone.now()
    for r in registros:
        if not area.intersects(r.geom):
            resumo.fora_do_recorte += 1
            continue
        geom = r.geom if r.geom.geom_type == "MultiPolygon" else MultiPolygon(r.geom, srid=4326)
        area_ha = r.propriedades.get("area_km")
        if isinstance(area_ha, int | float):
            area_ha = round(area_ha * 100, 2)
        else:
            m = geom.clone()
            m.transform(metrica)
            area_ha = round(m.area / 10_000, 2)
        ano = r.propriedades.get("year")
        _, criado = SupressaoAnual.objects.update_or_create(
            id_externo=r.id_externo,
            defaults={
                "ano": int(ano) if isinstance(ano, int | float) else r.data_deteccao.year,
                "data_imagem": r.data_deteccao.date(),
                "area_ha": area_ha,
                "satelite": str(r.propriedades.get("satellite") or "")[:60],
                "geom": geom,
                "src_original": r.src_original,
                "propriedades": r.propriedades,
                "fonte": FONTE,
                "fonte_url": origem if origem.startswith("http") else URL_PAGINA,
                "licenca": LICENCA,
                "ingerido_em": agora,
            },
        )
        resumo.novos += criado
        resumo.atualizados += not criado
    return resumo
