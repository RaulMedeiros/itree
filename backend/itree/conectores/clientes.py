"""Um cliente por tipo de conector. Todos devolvem o mesmo: ``Baixado`` (conteúdo e formato).

Para GeoJSON, WFS e ArcGIS o resultado é sempre uma FeatureCollection em JSON, montada
aqui quando a fonte entrega em páginas. O CKAN pode terminar em GeoJSON ou CSV. A leitura
do conteúdo (``feicoes``) trata tudo como dado não confiável: só interpreta, nunca executa.
"""

import json
from dataclasses import dataclass
from urllib.parse import urlsplit

from django.conf import settings

from . import seguranca
from .models import TipoConector
from .seguranca import ErroConector


@dataclass
class Baixado:
    formato: str  # "geojson" ou "csv"
    conteudo: bytes
    paginas: int = 1


def _json(conteudo: bytes, o_que: str) -> dict:
    try:
        dados = json.loads(conteudo.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ErroConector(f"A fonte não devolveu {o_que} válido.") from exc
    if not isinstance(dados, dict):
        raise ErroConector(f"A fonte não devolveu {o_que} válido.")
    return dados


def _colecao(dados: dict, onde: str) -> list:
    if dados.get("type") != "FeatureCollection" or not isinstance(dados.get("features"), list):
        mensagem = (
            dados.get("error", {}).get("message") if isinstance(dados.get("error"), dict) else None
        )
        raise ErroConector(mensagem or f"{onde} não devolveu uma FeatureCollection GeoJSON.")
    return dados["features"]


def _serializar(feicoes: list) -> bytes:
    return json.dumps({"type": "FeatureCollection", "features": feicoes}).encode()


def _parametro(parametros: dict, nome: str, rotulo: str) -> str:
    valor = str(parametros.get(nome) or "").strip()
    if not valor:
        raise ErroConector(f"Informe {rotulo}.")
    return valor


def _limite_feicoes() -> int:
    return settings.ITREE_CONECTORES_MAX_FEICOES


def _conferir_limite(total: int) -> None:
    if total > _limite_feicoes():
        raise ErroConector(
            f"A fonte tem mais de {_limite_feicoes()} feições, o limite de uma sincronização."
        )


def _geojson_url(url: str, parametros: dict) -> Baixado:
    feicoes = _colecao(_json(seguranca.buscar(url), "GeoJSON"), "A fonte")
    _conferir_limite(len(feicoes))
    return Baixado("geojson", _serializar(feicoes))


def _wfs(url: str, parametros: dict) -> Baixado:
    camada = _parametro(parametros, "camada", "a camada (typeName) do WFS")
    consulta = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": camada,
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "count": _limite_feicoes() + 1,
    }
    feicoes = _colecao(_json(seguranca.buscar(url, consulta), "GeoJSON"), "O WFS")
    _conferir_limite(len(feicoes))
    return Baixado("geojson", _serializar(feicoes))


def _arcgis(url: str, parametros: dict) -> Baixado:
    """Consulta ``/query`` com ``f=geojson``, paginando por ``resultOffset``."""
    base = url.rstrip("/")
    if not base.endswith("/query"):
        base += "/query"
    try:
        tamanho = max(1, min(int(parametros.get("tamanho_pagina") or 1000), 5000))
    except (TypeError, ValueError) as exc:
        raise ErroConector("O tamanho da página precisa ser um número.") from exc
    consulta = {
        "where": str(parametros.get("where") or "1=1"),
        "outFields": "*",
        "outSR": 4326,
        "f": "geojson",
        "resultRecordCount": tamanho,
    }
    feicoes: list = []
    for pagina in range(1, settings.ITREE_CONECTORES_MAX_PAGINAS + 1):
        dados = _json(seguranca.buscar(base, {**consulta, "resultOffset": len(feicoes)}), "GeoJSON")
        recebidas = _colecao(dados, "O ArcGIS")
        feicoes.extend(recebidas)
        _conferir_limite(len(feicoes))
        mais = bool(dados.get("exceededTransferLimit")) or (
            dados.get("properties", {}).get("exceededTransferLimit") is True
        )
        if not recebidas or not (mais or len(recebidas) >= tamanho):
            return Baixado("geojson", _serializar(feicoes), paginas=pagina)
    raise ErroConector(
        f"A fonte passou do limite de {settings.ITREE_CONECTORES_MAX_PAGINAS} páginas "
        "numa sincronização."
    )


def _ckan(url: str, parametros: dict) -> Baixado:
    pacote = _parametro(parametros, "pacote", "o identificador do conjunto de dados (pacote)")
    base = url.rstrip("/")
    resposta = _json(
        seguranca.buscar(f"{base}/api/3/action/package_show", {"id": pacote}), "a resposta do CKAN"
    )
    if resposta.get("success") is not True or not isinstance(resposta.get("result"), dict):
        raise ErroConector("O CKAN não encontrou o conjunto de dados informado.")
    recursos = [r for r in resposta["result"].get("resources") or [] if isinstance(r, dict)]
    recurso = _escolher_recurso(recursos, str(parametros.get("recurso") or "").strip())
    endereco = str(recurso.get("url") or "")
    formato = str(recurso.get("format") or "").lower()
    conteudo = seguranca.buscar(endereco)
    if formato == "csv":
        return Baixado("csv", conteudo)
    feicoes = _colecao(_json(conteudo, "GeoJSON"), "O recurso")
    _conferir_limite(len(feicoes))
    return Baixado("geojson", _serializar(feicoes))


def _escolher_recurso(recursos: list[dict], id_recurso: str) -> dict:
    if id_recurso:
        for r in recursos:
            if r.get("id") == id_recurso:
                return r
        raise ErroConector("O recurso informado não existe no conjunto de dados.")
    for formato in ("geojson", "csv"):
        for r in recursos:
            if str(r.get("format") or "").lower() == formato and r.get("url"):
                return r
    raise ErroConector("O conjunto de dados não tem recurso GeoJSON nem CSV.")


CLIENTES = {
    TipoConector.GEOJSON_URL: _geojson_url,
    TipoConector.WFS: _wfs,
    TipoConector.ARCGIS_REST: _arcgis,
    TipoConector.CKAN: _ckan,
}


def baixar(tipo: str, url: str, parametros: dict) -> Baixado:
    cliente = CLIENTES.get(tipo)
    if cliente is None:
        raise ErroConector("Tipo de conector desconhecido.")
    if not urlsplit(url).scheme:
        raise ErroConector("Endereço inválido.")
    return cliente(url, parametros or {})
