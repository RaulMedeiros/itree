"""Leitura e ingestão de alertas das fontes externas (T-05 §3).

Cada fonte vira uma lista de ``Registro`` normalizados. A ingestão é idempotente
por (fonte, identificador externo), guarda os atributos originais, a data de
detecção separada da data de ingestão, e só mantém o que intersecta o município.

Disponibilidade, licença, formato e limites de cada API precisam ser
verificados antes do uso produtivo (DP-11). O formato dos arquivos aceitos
segue as publicações conhecidas; colunas alternativas são reconhecidas.
"""

import csv
import hashlib
import io
import json
from dataclasses import dataclass
from datetime import UTC, datetime

import requests
from django.conf import settings
from django.contrib.gis.gdal import CoordTransform, SpatialReference
from django.contrib.gis.geos import GEOSGeometry, Point
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from itree.core.geo import SRID_METRICO
from itree.territorio.models import Territorio, TipoTerritorio

from .models import AlertaAmbiental, FonteAlerta, IngestaoAlertas, TipoAlerta


class ErroFonte(Exception):
    pass


@dataclass
class Registro:
    id_externo: str
    geom: GEOSGeometry
    data_deteccao: datetime
    propriedades: dict
    src_original: str = "EPSG:4326"


def _primeiro(dados: dict, *chaves: str):
    minusculas = {str(k).lower(): v for k, v in dados.items()}
    for chave in chaves:
        valor = minusculas.get(chave.lower())
        if valor not in (None, ""):
            return valor
    return None


def _data(valor) -> datetime | None:
    if valor in (None, ""):
        return None
    texto = str(valor).strip().replace("/", "-")
    dt = parse_datetime(texto) or parse_datetime(texto.replace(" ", "T"))
    if dt is None and (d := parse_date(texto[:10])):
        dt = datetime(d.year, d.month, d.day)
    if dt is None:
        return None
    return dt if timezone.is_aware(dt) else timezone.make_aware(dt, UTC)


def ler_focos_csv(conteudo: bytes) -> tuple[list[Registro], int]:
    """BDQueimadas (CSV). Colunas reconhecidas: lat/latitude, lon/longitude,
    data_hora_gmt/datahora/data, id/foco_id e demais atributos preservados."""
    texto = conteudo.decode("utf-8-sig", errors="replace")
    try:
        dialeto = csv.Sniffer().sniff(texto[:4096], delimiters=",;")
    except csv.Error:
        dialeto = csv.excel
    registros, invalidos = [], 0
    for linha in csv.DictReader(io.StringIO(texto), dialect=dialeto):
        lat = _primeiro(linha, "lat", "latitude")
        lon = _primeiro(linha, "lon", "longitude")
        quando = _data(_primeiro(linha, "data_hora_gmt", "datahora", "data_hora", "data"))
        try:
            ponto = Point(
                float(str(lon).replace(",", ".")), float(str(lat).replace(",", ".")), srid=4326
            )
        except (TypeError, ValueError):
            invalidos += 1
            continue
        if quando is None:
            invalidos += 1
            continue
        ident = _primeiro(linha, "id", "foco_id", "id_foco")
        if ident is None:
            # Sem identificador na fonte: deriva um estável dos atributos do foco.
            satelite = _primeiro(linha, "satelite") or ""
            chave = f"{ponto.x:.5f}|{ponto.y:.5f}|{quando.isoformat()}|{satelite}"
            ident = hashlib.sha1(chave.encode(), usedforsecurity=False).hexdigest()[:20]
        registros.append(Registro(str(ident), ponto, quando, dict(linha)))
    return registros, invalidos


CHAVES_GEOJSON = {
    FonteAlerta.INPE_DETER: {"id": ("gid", "id", "fid"), "data": ("view_date", "date", "data")},
    FonteAlerta.MAPBIOMAS: {
        "id": ("alertCode", "alert_code", "id"),
        "data": ("detectedAt", "detected_at", "data"),
    },
}


def ler_geojson(conteudo: bytes, fonte: str) -> tuple[list[Registro], int]:
    try:
        dados = json.loads(conteudo)
    except json.JSONDecodeError as exc:
        raise ErroFonte(f"GeoJSON inválido: {exc.msg}.") from exc
    feicoes = dados.get("features") if isinstance(dados, dict) else None
    if not isinstance(feicoes, list):
        raise ErroFonte("Esperada uma FeatureCollection.")
    src = "EPSG:4326"
    crs = (dados.get("crs") or {}).get("properties", {}).get("name", "")
    if crs and "4326" not in crs and "CRS84" not in crs:
        src = crs
    chaves = CHAVES_GEOJSON.get(fonte, {"id": ("id",), "data": ("data",)})
    registros, invalidos = [], 0
    for f in feicoes:
        props = dict(f.get("properties") or {})
        ident = _primeiro({**props, "id": f.get("id") or props.get("id")}, *chaves["id"])
        quando = _data(_primeiro(props, *chaves["data"]))
        try:
            geom = GEOSGeometry(json.dumps(f["geometry"]))
        except Exception:  # noqa: BLE001 - geometria ausente ou inválida
            invalidos += 1
            continue
        if ident is None or quando is None:
            invalidos += 1
            continue
        if src != "EPSG:4326":
            geom.srid = int(src.split(":")[-1])
            geom.transform(4326)
        else:
            geom.srid = 4326
        registros.append(Registro(str(ident), geom, quando, props, src))
    return registros, invalidos


def ler(conteudo: bytes, fonte: str) -> tuple[list[Registro], int]:
    if fonte == FonteAlerta.INPE_FOCOS:
        return ler_focos_csv(conteudo)
    return ler_geojson(conteudo, fonte)


def baixar(url: str) -> bytes:
    """Busca o arquivo da fonte (WFS do TerraBrasilis com saída GeoJSON, CSV do
    BDQueimadas). Tempo limite curto; falhas ficam registradas na ingestão."""
    resposta = requests.get(url, timeout=getattr(settings, "ALERTAS_TIMEOUT", 60))
    resposta.raise_for_status()
    return resposta.content


TIPO_POR_FONTE = {
    FonteAlerta.INPE_FOCOS: TipoAlerta.FOCO_CALOR,
    FonteAlerta.INPE_DETER: TipoAlerta.SUPRESSAO,
    FonteAlerta.MAPBIOMAS: TipoAlerta.SUPRESSAO,
}


def ingerir(fonte: str, conteudo: bytes, origem: str, usuario=None) -> IngestaoAlertas:
    """Ingere o conteúdo, registrando o resultado mesmo em caso de erro."""
    ingestao = IngestaoAlertas.objects.create(fonte=fonte, origem=origem[:500], usuario=usuario)
    try:
        registros, invalidos = ler(conteudo, fonte)
        municipio = (
            Territorio.objects.filter(tipo=TipoTerritorio.MUNICIPIO)
            .values_list("geom", flat=True)
            .first()
        )
        if municipio is None:
            raise ErroFonte(
                "Nenhum município cadastrado: importe os territórios antes dos alertas."
            )
        bairros = list(
            Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO).only("id", "nome", "geom")
        )
        ingestao.recebidos = len(registros)
        ingestao.invalidos = invalidos
        existentes = set(
            AlertaAmbiental.objects.filter(
                fonte=fonte, id_externo__in=[r.id_externo for r in registros]
            ).values_list("id_externo", flat=True)
        )
        transformacao = CoordTransform(SpatialReference(4326), SpatialReference(SRID_METRICO))
        for r in registros:
            if r.id_externo in existentes:
                ingestao.ja_existentes += 1
                continue
            if not municipio.intersects(r.geom):
                ingestao.fora_do_municipio += 1
                continue
            area = None
            if r.geom.geom_type in ("Polygon", "MultiPolygon"):
                metrica = r.geom.clone()
                metrica.transform(transformacao)
                area = round(metrica.area / 10_000, 2)
            AlertaAmbiental.objects.create(
                fonte=fonte,
                id_externo=r.id_externo,
                tipo=TIPO_POR_FONTE[fonte],
                geom=r.geom,
                src_original=r.src_original,
                area_ha=area,
                data_deteccao=r.data_deteccao,
                propriedades=r.propriedades,
                bairros=[
                    {"id": str(b.id), "nome": b.nome} for b in bairros if b.geom.intersects(r.geom)
                ],
            )
            existentes.add(r.id_externo)
            ingestao.novos += 1
        ingestao.sucesso = True
    except (ErroFonte, requests.RequestException) as exc:
        ingestao.erro = str(exc)
    except Exception as exc:  # noqa: BLE001 - registrar qualquer falha da fonte
        ingestao.erro = f"Falha inesperada: {exc.__class__.__name__}: {exc}"
    ingestao.concluida_em = timezone.now()
    ingestao.save()
    return ingestao
