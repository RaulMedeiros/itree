"""Macrozoneamento Urbano de Fortaleza (SEUMA, 2022): zonas de ocupação, só leitura.

Fonte: Fortaleza em Mapas, mapa 604 (GeoJSON, 25 feições, SIRGAS 2000 em EPSG:4326 na API).
As zonas vêm com os parâmetros de ocupação (taxa de permeabilidade, taxa de ocupação, índices de
aproveitamento, altura máxima etc.) num texto HTML, lido aqui em pares nome/valor. É contexto: não
altera o inventário nem classifica a árvore, apenas diz em que zona ela está.
"""

import json
import re
from datetime import date

from django.contrib.gis.geos import GEOSGeometry, MultiPolygon, Point, Polygon
from django.db import connection, transaction
from django.utils import timezone

from itree.territorio.importacao import geometria_valida

from .models import Macrozona

ID_MAPA = 604
URL_GEOJSON = f"https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id={ID_MAPA}"
URL_PAGINA = "https://mapas.fortaleza.ce.gov.br/mapa/604/macrozoneamento-urbano-de-fortaleza"
FONTE = "SEUMA, Macrozoneamento Urbano de Fortaleza, 2022 (Fortaleza em Mapas, mapa 604)"
LICENCA = "Termos da API do Fortaleza em Mapas: uso livre, com citação da fonte"
DATA_REFERENCIA = date(2022, 12, 31)
MAX_FEICOES = 500
SIGLAS = {
    "zona de ocupacao preferencial": "ZOP",
    "zona de ocupacao consolidada": "ZOC",
    "zona de requalificacao urbana": "ZRU",
    "zona de ocupacao moderada": "ZOM",
    "zona de ocupacao restrita": "ZOR",
    "zona de orla": "ZO",
}
_PAR = re.compile(r"<i>\s*([^:<]+?)\s*:\s*<b>\s*([^<]*?)\s*</b>", re.IGNORECASE)


class FonteInvalida(ValueError):
    """O arquivo não é o GeoJSON do macrozoneamento."""


def _sem_acento(texto: str) -> str:
    import unicodedata

    return "".join(
        c for c in unicodedata.normalize("NFD", texto.lower()) if unicodedata.category(c) != "Mn"
    )


def sigla_da_zona(nome: str) -> str:
    """ZOP 1, ZRU 2, ZO - Trecho I...: a sigla do tipo de zona mais o número ou trecho."""
    chave = _sem_acento(nome)
    for prefixo, sigla in SIGLAS.items():
        if chave.startswith(prefixo):
            resto = chave[len(prefixo) :].strip(" -")
            numero = re.match(r"(\d+)", resto)
            if numero:
                return f"{sigla} {numero.group(1)}"
            return sigla
    return ""


def parametros_da_descricao(descricao: str) -> dict[str, str]:
    return {nome: valor for nome, valor in _PAR.findall(descricao or "") if valor}


def ler(conteudo: bytes) -> list[dict]:
    try:
        dados = json.loads(conteudo)
        feicoes = dados["features"]
    except (ValueError, KeyError, TypeError) as exc:
        raise FonteInvalida("GeoJSON do macrozoneamento ilegível.") from exc
    if not isinstance(feicoes, list) or not feicoes or len(feicoes) > MAX_FEICOES:
        raise FonteInvalida("Número de feições inesperado no macrozoneamento.")
    registros = []
    for f in feicoes:
        p = f.get("properties") or {}
        nome = " ".join(str(p.get("nome", "")).split())
        try:
            id_fonte = int(p["id"])
            geom = GEOSGeometry(json.dumps(f["geometry"]), srid=4326)
        except (KeyError, TypeError, ValueError):
            continue
        if not nome or geom.empty:
            continue
        if geom.hasz:  # a fonte traz o eixo Z (zero); a coluna é 2D
            ogr = geom.ogr
            ogr.set_3d(False)
            geom = GEOSGeometry(ogr.wkb, srid=4326)
        if isinstance(geom, Polygon):
            geom = MultiPolygon(geom, srid=4326)
        if not isinstance(geom, MultiPolygon):
            continue
        parametros = parametros_da_descricao(str(p.get("descricao", "")))
        if p.get("fracao_lote") is not None:
            parametros["Fração do lote (%)"] = str(p["fracao_lote"])
        registros.append(
            {
                "codigo_fonte": id_fonte,
                "nome": nome,
                "geom": geometria_valida(geom),
                "parametros": parametros,
            }
        )
    if not registros:
        raise FonteInvalida("Nenhuma zona válida no arquivo.")
    return registros


@transaction.atomic
def importar(conteudo: bytes, *, fonte_url: str = URL_PAGINA, ingerido_em=None) -> dict:
    registros = ler(conteudo)
    agora = ingerido_em or timezone.now()
    vistos = set()
    for r in registros:
        vistos.add(r["codigo_fonte"])
        Macrozona.objects.update_or_create(
            codigo_fonte=r["codigo_fonte"],
            defaults={
                "nome": r["nome"],
                "sigla": sigla_da_zona(r["nome"]),
                "geom": r["geom"],
                "parametros": r["parametros"],
                "fonte": FONTE,
                "fonte_url": fonte_url,
                "licenca": LICENCA,
                "data_referencia": DATA_REFERENCIA,
                "ingerido_em": agora,
            },
        )
    removidas = Macrozona.objects.exclude(codigo_fonte__in=vistos).delete()[0]
    return {"zonas": len(registros), "removidas": removidas}


def zona_do_ponto(lon: float, lat: float) -> Macrozona | None:
    """Zona que contém o ponto (a de menor área, se houver sobreposição). ``None`` fora delas."""
    return (
        Macrozona.objects.filter(geom__contains=Point(lon, lat, srid=4326))
        .extra(select={"area": "ST_Area(geom)"})
        .order_by("area")
        .first()
    )


def partilha_do_bairro(bairro_id) -> list[dict]:
    """Percentual da área do bairro em cada zona (em UTM 24S). Só as zonas que o tocam; o que
    sobra é "fora das zonas" (a macrozona de ocupação urbana não cobre o município inteiro)."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            WITH b AS (
                SELECT ST_Transform(geom, 31984) AS g FROM territorio_territorio WHERE id = %s
            )
            SELECT m.nome, m.sigla,
                   ST_Area(ST_Intersection(ST_Transform(m.geom, 31984), b.g)) AS area, ST_Area(b.g)
              FROM imoveis_macrozona m, b
             WHERE ST_Intersects(ST_Transform(m.geom, 31984), b.g)
            """,
            [str(bairro_id)],
        )
        linhas = cursor.fetchall()
    if not linhas:
        return []
    total = linhas[0][3]
    saida = [
        {"nome": n, "sigla": s, "pct": round(100 * a / total, 1)}
        for n, s, a, _ in linhas
        if total and a / total >= 0.005
    ]
    return sorted(saida, key=lambda z: -z["pct"])
