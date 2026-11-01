"""Referências externas das espécies do catálogo (M-01).

O Wikidata é o ponto de partida: o item é localizado pelo nome científico
(propriedade P225, "nome do táxon") e só é aceito se esse nome for **igual**
ao do catálogo. Do item vêm os vínculos para a Wikipedia (pt, senão en), a
imagem no Wikimedia Commons (P18) e o identificador do GBIF (P846).

Nada é inventado ou completado por aproximação: sem item correspondente, a
espécie fica como "não encontrada"; uma imagem sem licença declarada não é
usada. Os textos e imagens são exibidos com fonte, licença e data de consulta.
"""

import html
import re
from dataclasses import dataclass, field
from urllib.parse import quote

import requests
from django.conf import settings
from django.utils import timezone

from .models import Especie, SituacaoReferencias

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
WIKIDATA_ENTIDADE = "https://www.wikidata.org/wiki/Special:EntityData/{id}.json"
WIKIPEDIA_RESUMO = "https://{idioma}.wikipedia.org/api/rest_v1/page/summary/{titulo}"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
IDIOMAS = ("pt", "en")
LARGURA_IMAGEM = 960


class ErroConsulta(Exception):
    pass


@dataclass
class Referencias:
    encontrada: bool
    mensagem: str = ""
    campos: dict = field(default_factory=dict)


def _sessao() -> requests.Session:
    s = requests.Session()
    # Política de uso da Wikimedia: identificar o cliente.
    s.headers["User-Agent"] = settings.REFERENCIAS_USER_AGENT
    return s


def _json(sessao: requests.Session, url: str, **params) -> dict:
    try:
        r = sessao.get(url, params=params or None, timeout=settings.REFERENCIAS_TIMEOUT)
    except requests.RequestException as exc:
        raise ErroConsulta(f"Falha de rede ao consultar {url.split('/')[2]}.") from exc
    if r.status_code == 404:
        return {}
    if r.status_code >= 400:
        raise ErroConsulta(f"{url.split('/')[2]} respondeu {r.status_code}.")
    return r.json()


def _normalizar(nome: str) -> str:
    return " ".join(nome.split()).casefold()


def _valor(entidade: dict, propriedade: str):
    for afirmacao in entidade.get("claims", {}).get(propriedade, []):
        valor = afirmacao.get("mainsnak", {}).get("datavalue", {}).get("value")
        if valor is not None:
            return valor
    return None


def _texto_simples(valor: str) -> str:
    """Metadados do Commons vêm em HTML; guarda só o texto."""
    return html.unescape(re.sub(r"<[^>]+>", "", valor or "")).strip()


def localizar_item(sessao: requests.Session, nome_cientifico: str) -> dict | None:
    """Item do Wikidata cujo nome do táxon (P225) é exatamente o informado."""
    busca = _json(
        sessao,
        WIKIDATA_API,
        action="query",
        list="search",
        srsearch=f'haswbstatement:P225="{nome_cientifico}"',
        srlimit=5,
        format="json",
    )
    for resultado in busca.get("query", {}).get("search", []):
        qid = resultado.get("title", "")
        if not re.fullmatch(r"Q\d+", qid):
            continue
        entidade = _json(sessao, WIKIDATA_ENTIDADE.format(id=qid)).get("entities", {}).get(qid)
        if entidade and _normalizar(str(_valor(entidade, "P225") or "")) == _normalizar(
            nome_cientifico
        ):
            return entidade
    return None


def _wikipedia(sessao: requests.Session, entidade: dict) -> dict:
    links = entidade.get("sitelinks", {})
    for idioma in IDIOMAS:
        titulo = links.get(f"{idioma}wiki", {}).get("title")
        if not titulo:
            continue
        resumo = _json(
            sessao,
            WIKIPEDIA_RESUMO.format(idioma=idioma, titulo=quote(titulo.replace(" ", "_"), safe="")),
        )
        if not resumo or resumo.get("type") == "disambiguation":
            continue
        return {
            "wikipedia_idioma": idioma,
            "wikipedia_titulo": resumo.get("title", titulo)[:300],
            "wikipedia_url": resumo.get("content_urls", {})
            .get("desktop", {})
            .get("page", "")[:500],
            "wikipedia_descricao": (resumo.get("description") or "")[:300],
            "wikipedia_resumo": resumo.get("extract") or "",
        }
    return {}


def _imagem(sessao: requests.Session, entidade: dict) -> dict:
    arquivo = _valor(entidade, "P18")
    if not arquivo:
        return {}
    dados = _json(
        sessao,
        COMMONS_API,
        action="query",
        titles=f"File:{arquivo}",
        prop="imageinfo",
        iiprop="url|extmetadata",
        iiurlwidth=LARGURA_IMAGEM,
        format="json",
    )
    for pagina in dados.get("query", {}).get("pages", {}).values():
        info = (pagina.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        licenca = _texto_simples(meta.get("LicenseShortName", {}).get("value", ""))
        if not licenca:
            # Sem licença declarada a imagem não é usada.
            return {}
        return {
            "imagem_url": (info.get("thumburl") or info.get("url") or "")[:1000],
            "imagem_pagina_url": (info.get("descriptionurl") or "")[:1000],
            "imagem_autor": _texto_simples(meta.get("Artist", {}).get("value", ""))[:300],
            "imagem_licenca": licenca[:100],
            "imagem_licenca_url": _texto_simples(meta.get("LicenseUrl", {}).get("value", ""))[:500],
        }
    return {}


def consultar(nome_cientifico: str) -> Referencias:
    sessao = _sessao()
    entidade = localizar_item(sessao, nome_cientifico)
    if entidade is None:
        return Referencias(False, "Nenhum item do Wikidata com este nome científico exato (P225).")
    gbif = _valor(entidade, "P846")
    campos = {
        "wikidata_id": entidade["id"],
        "gbif_id": int(gbif) if gbif and str(gbif).isdigit() else None,
        **_wikipedia(sessao, entidade),
        **_imagem(sessao, entidade),
    }
    faltando = [
        nome
        for nome, chave in (("artigo na Wikipedia", "wikipedia_url"), ("imagem", "imagem_url"))
        if not campos.get(chave)
    ]
    mensagem = f"Sem {' nem '.join(faltando)}." if faltando else ""
    return Referencias(True, mensagem, campos)


CAMPOS_REFERENCIA = (
    "wikidata_id",
    "wikipedia_idioma",
    "wikipedia_titulo",
    "wikipedia_url",
    "wikipedia_descricao",
    "wikipedia_resumo",
    "gbif_id",
    "imagem_url",
    "imagem_pagina_url",
    "imagem_autor",
    "imagem_licenca",
    "imagem_licenca_url",
)


def atualizar(especie: Especie) -> Especie:
    """Consulta e grava as referências. Em erro de rede, mantém as anteriores."""
    try:
        resultado = consultar(especie.nome_cientifico)
    except ErroConsulta as exc:
        especie.referencias_situacao = SituacaoReferencias.ERRO
        especie.referencias_mensagem = str(exc)[:300]
        especie.referencias_consultadas_em = timezone.now()
        especie.save(
            update_fields=[
                "referencias_situacao",
                "referencias_mensagem",
                "referencias_consultadas_em",
                "atualizado_em",
            ]
        )
        return especie

    for campo in CAMPOS_REFERENCIA:
        padrao = None if campo == "gbif_id" else ""
        setattr(especie, campo, resultado.campos.get(campo, padrao) or padrao)
    especie.referencias_situacao = (
        SituacaoReferencias.ENCONTRADAS
        if resultado.encontrada
        else SituacaoReferencias.NAO_ENCONTRADAS
    )
    especie.referencias_mensagem = resultado.mensagem[:300]
    especie.referencias_consultadas_em = timezone.now()
    especie.save(
        update_fields=[
            *CAMPOS_REFERENCIA,
            "referencias_situacao",
            "referencias_mensagem",
            "referencias_consultadas_em",
            "atualizado_em",
        ]
    )
    return especie
