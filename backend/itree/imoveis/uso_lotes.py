"""Uso predominante por lote (SEFIN, 2022), pelo WMS do Fortaleza em Mapas.

O Fortaleza em Mapas publica o uso predominante por lote só como WMS (mapas 562 a 566 e 705 a 713,
uma camada ``vw_UsoPorLoteSER<n>`` por regional; o endpoint GeoJSON dá erro 500). A URL do WMS
sai do front-end da plataforma (``AppService.js`` e ``LeafletFunctionService.js``): ``POST
/api/getMap/<id>`` devolve o nome da camada e a legenda, e o serviço fica em ``/api/v1/ows``,
um proxy do GeoServer do Ipplan. Verificado em 21/11/2026: ``GetMap`` e ``GetFeatureInfo`` (JSON,
com a geometria e os atributos do lote) respondem; ``GetCapabilities`` e WFS não.

O ``GetFeatureInfo`` devolve só os lotes sob um ponto, mas aceita o parâmetro ``buffer`` (raio em
pixels) e ``FEATURE_COUNT``: com uma janela de 600 x 600 pixels e buffer de 425 pixels, uma
consulta devolve todos os lotes de um quadrado de cerca de 650 m (centenas de lotes). Percorre-se
cada regional em quadrados e guardam-se os lotes (sem repetição), para classificar as edificações
pelo lote que contém o centro (um ``UPDATE`` no banco, sem consulta por edificação). As consultas
são sequenciais, com pausa, e a carga é retomável (``--regional``).

Atributos do lote usados: ``uso_solo`` (Residencial, Não Residencial, Misto, Territorial; regra dos
70% da SEFIN), ``qtd_unidad``, ``qtd_reside``, ``qtd_nao_re``, ``area_edif_`` (residencial, m²) e
``area_edi_1`` (não residencial, m²).
"""

import json
import math
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

import requests
from django.contrib.gis.geos import GEOSGeometry, MultiPolygon, Polygon
from django.db import connection, transaction
from django.utils import timezone

from itree.territorio.models import Territorio, TipoTerritorio

from .models import LoteUsoSolo, UsoLote

URL_OWS = "https://mapas.fortaleza.ce.gov.br/api/v1/ows"
HOST_PERMITIDO = "mapas.fortaleza.ce.gov.br"
FONTE = "SEFIN, Uso predominante por lote, 2022 (Fortaleza em Mapas, mapas 562 a 566 e 705 a 713)"
LICENCA = "Termos da API do Fortaleza em Mapas: uso livre, com citação da fonte"
REGIONAIS = range(1, 13)
LADO_GRAUS = 0.006  # lado do quadrado consultado (~650 m)
JANELA_PX = 600
BUFFER_PX = math.ceil(JANELA_PX / 2 * math.sqrt(2))
LIMITE_FEICOES = 3000
MAX_DIVISOES = 4  # níveis de divisão de um quadrado cuja resposta chegou ao limite
PAUSA_S = 0.2
TIMEOUT_S = 90
TENTATIVAS = 3
USOS = {
    "residencial": UsoLote.RESIDENCIAL,
    "nao residencial": UsoLote.NAO_RESIDENCIAL,
    "não residencial": UsoLote.NAO_RESIDENCIAL,
    "misto": UsoLote.MISTO,
    "territorial": UsoLote.TERRITORIAL,
}


def camada_da_regional(numero: int) -> str:
    return f"vw_UsoPorLoteSER{numero}"


class ErroWms(RuntimeError):
    pass


@dataclass
class Colheita:
    requisicoes: int = 0
    lotes: int = 0
    truncadas: int = 0
    descartados: int = 0
    falhas: list[str] = field(default_factory=list)


def _exigir_host(url: str) -> None:
    partes = urlparse(url)
    if partes.scheme != "https" or partes.hostname != HOST_PERMITIDO:
        raise ErroWms(f"Só se consulta https://{HOST_PERMITIDO}/ ({url}).")


def consultar(camada: str, oeste: float, sul: float, leste: float, norte: float, *, url=URL_OWS):
    """``GetFeatureInfo`` (JSON) com os lotes do quadrado. Devolve a lista de feições."""
    _exigir_host(url)
    parametros = {
        "SERVICE": "WMS",
        "VERSION": "1.1.1",
        "REQUEST": "GetFeatureInfo",
        "LAYERS": camada,
        "QUERY_LAYERS": camada,
        "STYLES": "",
        "SRS": "EPSG:4326",
        "BBOX": f"{oeste:.6f},{sul:.6f},{leste:.6f},{norte:.6f}",
        "WIDTH": JANELA_PX,
        "HEIGHT": JANELA_PX,
        "X": JANELA_PX // 2,
        "Y": JANELA_PX // 2,
        "INFO_FORMAT": "application/json",
        "FEATURE_COUNT": LIMITE_FEICOES,
        "buffer": BUFFER_PX,
    }
    ultimo = None
    for tentativa in range(TENTATIVAS):
        try:
            resposta = requests.get(url, params=parametros, timeout=TIMEOUT_S)
            resposta.raise_for_status()
            dados = resposta.json()
            feicoes = dados.get("features")
            if not isinstance(feicoes, list):
                raise ErroWms("Resposta sem lista de feições.")
            return feicoes
        except (requests.RequestException, ValueError, ErroWms) as exc:
            ultimo = exc
            time.sleep(2 * (tentativa + 1))
    raise ErroWms(f"{camada} {parametros['BBOX']}: {ultimo}")


def lote_da_feicao(feicao: dict, camada: str, agora) -> LoteUsoSolo | None:
    """Lote a gravar, ou ``None`` se a feição for inválida (conteúdo não confiável)."""
    p = feicao.get("properties") or {}
    uso = USOS.get(str(p.get("uso_solo", "")).strip().lower())
    try:
        id_fonte = int(p["id"])
        geom = GEOSGeometry(json.dumps(feicao["geometry"]), srid=4326)
    except (KeyError, TypeError, ValueError):
        return None
    if uso is None or id_fonte < 0:
        return None
    if isinstance(geom, Polygon):
        geom = MultiPolygon(geom, srid=4326)
    if not isinstance(geom, MultiPolygon) or geom.empty:
        return None

    def numero(chave):
        try:
            valor = float(p.get(chave))
        except (TypeError, ValueError):
            return None
        return valor if math.isfinite(valor) and valor >= 0 else None

    def inteiro(chave):
        valor = numero(chave)
        return int(valor) if valor is not None else 0

    return LoteUsoSolo(
        camada=camada,
        id_fonte=id_fonte,
        geom=geom,
        uso=uso,
        unidades=inteiro("qtd_unidad"),
        unidades_residenciais=inteiro("qtd_reside"),
        unidades_nao_residenciais=inteiro("qtd_nao_re"),
        area_residencial_m2=numero("area_edif_"),
        area_nao_residencial_m2=numero("area_edi_1"),
        ingerido_em=agora,
    )


def quadrados(regional_geom, lado: float | None = None):
    """Quadrados (oeste, sul, leste, norte) de ``lado`` graus que tocam a regional."""
    lado = lado or LADO_GRAUS
    oeste, sul, leste, norte = regional_geom.extent
    prepared = regional_geom.prepared
    n_x = math.ceil((leste - oeste) / lado)
    n_y = math.ceil((norte - sul) / lado)
    for j in range(n_y):
        for i in range(n_x):
            x0, y0 = oeste + i * lado, sul + j * lado
            caixa = Polygon.from_bbox((x0, y0, x0 + lado, y0 + lado))
            caixa.srid = 4326
            if prepared.intersects(caixa):
                yield x0, y0, x0 + lado, y0 + lado


def _subdividir(oeste, sul, leste, norte):
    mx, my = (oeste + leste) / 2, (sul + norte) / 2
    return [
        (oeste, sul, mx, my),
        (mx, sul, leste, my),
        (oeste, my, mx, norte),
        (mx, my, leste, norte),
    ]


def colher_regional(
    numero: int,
    regional_geom,
    *,
    consulta=consultar,
    max_requisicoes=None,
    pausa=PAUSA_S,
    saida=None,
) -> Colheita:
    """Percorre a regional e grava os lotes (sem repetição). Quadrado cuja resposta chegou ao
    limite de feições é dividido em quatro (a resposta truncada não é aceita)."""
    camada = camada_da_regional(numero)
    colheita = Colheita()
    vistos: set[int] = set(
        LoteUsoSolo.objects.filter(camada=camada).values_list("id_fonte", flat=True)
    )
    pendentes = [(q, 0) for q in quadrados(regional_geom)]
    agora = timezone.now()
    lote_gravar: list[LoteUsoSolo] = []

    def gravar():
        if lote_gravar:
            LoteUsoSolo.objects.bulk_create(
                lote_gravar,
                update_conflicts=True,
                unique_fields=["camada", "id_fonte"],
                update_fields=[
                    "geom",
                    "uso",
                    "unidades",
                    "unidades_residenciais",
                    "unidades_nao_residenciais",
                    "area_residencial_m2",
                    "area_nao_residencial_m2",
                    "ingerido_em",
                ],
            )
            colheita.lotes += len(lote_gravar)
            lote_gravar.clear()

    while pendentes:
        if max_requisicoes is not None and colheita.requisicoes >= max_requisicoes:
            break
        quadrado, nivel = pendentes.pop()
        try:
            feicoes = consulta(camada, *quadrado)
        except ErroWms as exc:
            colheita.falhas.append(str(exc))
            continue
        colheita.requisicoes += 1
        if len(feicoes) >= LIMITE_FEICOES:
            colheita.truncadas += 1
            if nivel < MAX_DIVISOES:
                pendentes.extend((q, nivel + 1) for q in _subdividir(*quadrado))
                continue
            colheita.falhas.append(f"{camada} {quadrado}: resposta no limite mesmo dividida.")
        for feicao in feicoes:
            lote = lote_da_feicao(feicao, camada, agora)
            if lote is None:
                colheita.descartados += 1
            elif lote.id_fonte not in vistos:
                vistos.add(lote.id_fonte)
                lote_gravar.append(lote)
        if len(lote_gravar) >= 2000:
            gravar()
        if saida is not None and colheita.requisicoes % 25 == 0:
            saida(f"SER {numero}: {colheita.requisicoes} consultas, {len(vistos)} lotes.")
        time.sleep(pausa)
    gravar()
    return colheita


def regionais_geometrias() -> dict[int, object]:
    saida = {}
    for r in Territorio.objects.filter(tipo=TipoTerritorio.REGIONAL):
        try:
            saida[int(r.codigo)] = r.geom
        except ValueError:
            continue
    return saida


def classificar_edificacoes() -> dict:
    """Classifica cada edificação pelo lote (SEFIN 2022) que contém o seu centro. Edificação
    fora de qualquer lote colhido fica sem uso. Devolve a cobertura."""
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("UPDATE imoveis_edificacao SET uso = '' WHERE uso <> ''")
        cursor.execute(
            f"""
            UPDATE imoveis_edificacao e SET uso = l.uso
              FROM {LoteUsoSolo._meta.db_table} l
             WHERE ST_Contains(l.geom, e.centro)
            """  # noqa: S608 - nome de tabela vem do modelo
        )
        classificadas = cursor.rowcount
        cursor.execute("SELECT count(*) FROM imoveis_edificacao")
        total = cursor.fetchone()[0]
        cursor.execute("SELECT uso, count(*) FROM imoveis_edificacao WHERE uso <> '' GROUP BY uso")
        por_uso = dict(cursor.fetchall())
    return {
        "edificacoes": total,
        "classificadas": classificadas,
        "cobertura": classificadas / total if total else None,
        "por_uso": por_uso,
    }
