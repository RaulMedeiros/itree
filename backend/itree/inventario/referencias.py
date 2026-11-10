"""Referências externas das espécies do catálogo (M-01).

O Wikidata é o ponto de partida: o item é localizado pelo nome científico
(propriedade P225, "nome do táxon") e só é aceito se esse nome for **igual**
ao do catálogo. Do item vêm os vínculos para a Wikipedia (pt, senão en), a
imagem no Wikimedia Commons (P18) e o identificador do GBIF (P846). Se o item
não tem link para a Wikipedia, o artigo é procurado pelo nome científico, mas
só é aceito se o item do próprio artigo tiver P225 idêntico ao do catálogo.

Nada é inventado ou completado por aproximação: sem item correspondente, a
espécie fica como "não encontrada"; uma imagem sem licença declarada não é
usada. Os textos e imagens são exibidos com fonte, licença e data de consulta.
"""

import html
import io
import re
import time
from dataclasses import dataclass, field
from urllib.parse import quote

import requests
from django.conf import settings
from django.utils import timezone
from PIL import Image, UnidentifiedImageError

from itree.core import armazenamento

from .models import Especie, SituacaoReferencias

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
WIKIDATA_ENTIDADE = "https://www.wikidata.org/wiki/Special:EntityData/{id}.json"
WIKIPEDIA_API = "https://{idioma}.wikipedia.org/w/api.php"
WIKIPEDIA_RESUMO = "https://{idioma}.wikipedia.org/api/rest_v1/page/summary/{titulo}"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
IDIOMAS = ("pt", "en")
LARGURA_IMAGEM = 960
MAX_CANDIDATOS = 5


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


TAMANHO_MAXIMO_ORIGINAL = 30 * 1024 * 1024
LADO_MAXIMO_COPIA = 960
TENTATIVAS = 3
ESPERA_MAXIMA = 30.0


def _esperar(segundos: float) -> None:
    time.sleep(segundos)


def _json(sessao: requests.Session, url: str, **params) -> dict:
    """GET com JSON. Respeita o limite de taxa da Wikimedia (429 + Retry-After)."""
    host = url.split("/")[2]
    for tentativa in range(1, TENTATIVAS + 1):
        try:
            r = sessao.get(url, params=params or None, timeout=settings.REFERENCIAS_TIMEOUT)
        except requests.RequestException as exc:
            raise ErroConsulta(f"Falha de rede ao consultar {host}.") from exc
        if r.status_code == 429 and tentativa < TENTATIVAS:
            try:
                espera = float(r.headers.get("Retry-After", 5))
            except ValueError:
                espera = 5.0
            _esperar(min(max(espera, 1.0), ESPERA_MAXIMA))
            continue
        if r.status_code == 404:
            return {}
        if r.status_code == 429:
            raise ErroConsulta(f"{host} limitou as consultas (429); tente mais tarde.")
        if r.status_code >= 400:
            raise ErroConsulta(f"{host} respondeu {r.status_code}.")
        try:
            dados = r.json()
        except ValueError as exc:
            raise ErroConsulta(f"{host} devolveu uma resposta que não é JSON.") from exc
        # A API do MediaWiki sinaliza erros (inclusive limite de taxa) com
        # status 200 e {"error": ...}: isso não pode virar "nada encontrado".
        if isinstance(dados, dict) and "error" in dados:
            codigo = str(dados["error"].get("code", "erro"))
            if tentativa < TENTATIVAS:
                _esperar(5.0)
                continue
            raise ErroConsulta(f"{host} recusou a consulta ({codigo}).")
        return dados
    return {}


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
        # Sintaxe do CirrusSearch: propriedade e valor juntos entre aspas.
        srsearch=f'haswbstatement:"P225={nome_cientifico}"',
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


def _resumo_artigo(sessao: requests.Session, idioma: str, titulo: str) -> dict:
    """Campos do artigo (REST summary); vazio se não existir ou for desambiguação."""
    resumo = _json(
        sessao,
        WIKIPEDIA_RESUMO.format(idioma=idioma, titulo=quote(titulo.replace(" ", "_"), safe="")),
    )
    if not resumo or resumo.get("type") == "disambiguation":
        return {}
    return {
        "wikipedia_idioma": idioma,
        "wikipedia_titulo": resumo.get("title", titulo)[:300],
        "wikipedia_url": resumo.get("content_urls", {}).get("desktop", {}).get("page", "")[:500],
        "wikipedia_descricao": (resumo.get("description") or "")[:300],
        "wikipedia_resumo": resumo.get("extract") or "",
    }


def _buscar_artigo(sessao: requests.Session, idioma: str, nome_cientifico: str) -> dict:
    """Procura na Wikipedia o artigo do táxon quando o item do Wikidata não tem
    link. Cada candidato (no máximo 5, em ordem de relevância) só é aceito se
    o item do Wikidata do artigo tiver P225 exatamente igual ao nome
    científico; desambiguações são descartadas. Falha da busca não derruba o
    restante do enriquecimento: o artigo apenas não é encontrado."""
    try:
        busca = _json(
            sessao,
            WIKIPEDIA_API.format(idioma=idioma),
            action="query",
            generator="search",
            gsrsearch=nome_cientifico,
            gsrlimit=MAX_CANDIDATOS,
            prop="pageprops",
            ppprop="wikibase_item|disambiguation",
            format="json",
        )
        paginas = sorted(
            busca.get("query", {}).get("pages", {}).values(),
            key=lambda pagina: pagina.get("index", 0),
        )
        for pagina in paginas[:MAX_CANDIDATOS]:
            props = pagina.get("pageprops", {})
            qid = props.get("wikibase_item", "")
            titulo = pagina.get("title")
            if "disambiguation" in props or not titulo or not re.fullmatch(r"Q\d+", qid):
                continue
            entidade = _json(sessao, WIKIDATA_ENTIDADE.format(id=qid)).get("entities", {}).get(qid)
            if not entidade or _normalizar(str(_valor(entidade, "P225") or "")) != _normalizar(
                nome_cientifico
            ):
                continue
            artigo = _resumo_artigo(sessao, idioma, titulo)
            if artigo:
                return artigo
    except ErroConsulta:
        return {}
    return {}


def _wikipedia(sessao: requests.Session, entidade: dict, nome_cientifico: str) -> dict:
    links = entidade.get("sitelinks", {})
    for idioma in IDIOMAS:
        titulo = links.get(f"{idioma}wiki", {}).get("title")
        if titulo and (artigo := _resumo_artigo(sessao, idioma, titulo)):
            return artigo
    # Sem link utilizável no item: busca pelo nome científico (pt, depois en).
    for idioma in IDIOMAS:
        if artigo := _buscar_artigo(sessao, idioma, nome_cientifico):
            return artigo
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
            # Fontes da cópia local, em ordem: a miniatura em tamanho padrão
            # (recomendação da Wikimedia) e, se falhar, o original. Não é gravado.
            "_imagem_fontes": [u for u in (info.get("thumburl"), info.get("url")) if u],
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
        **_wikipedia(sessao, entidade, nome_cientifico),
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


def _baixar(sessao: requests.Session, url: str) -> bytes | None:
    for tentativa in range(1, TENTATIVAS + 1):
        try:
            r = sessao.get(url, timeout=settings.REFERENCIAS_TIMEOUT * 4)
        except requests.RequestException:
            return None
        if r.status_code == 429 and tentativa < TENTATIVAS:
            try:
                espera = float(r.headers.get("Retry-After", 5))
            except ValueError:
                espera = 5.0
            if espera > ESPERA_MAXIMA:
                return None  # limite longo: tenta a próxima fonte
            _esperar(max(espera, 1.0))
            continue
        if r.status_code != 200 or len(r.content) > TAMANHO_MAXIMO_ORIGINAL:
            return None
        return r.content
    return None


def _copiar_imagem(sessao: requests.Session, especie: Especie, fontes: list[str]) -> str:
    """Baixa a imagem (miniatura padrão, senão o original), reduz para no
    máximo 960 px e guarda um JPEG no armazenamento da plataforma. Devolve a
    chave, ou "" se não for possível (o painel então exibe a miniatura da
    Wikimedia)."""
    if not fontes or not armazenamento.s3_configurado():
        return ""
    for url in fontes:
        conteudo = _baixar(sessao, url)
        if conteudo is None:
            continue
        try:
            with Image.open(io.BytesIO(conteudo)) as imagem:
                imagem.thumbnail((LADO_MAXIMO_COPIA, LADO_MAXIMO_COPIA))
                saida = io.BytesIO()
                imagem.convert("RGB").save(saida, "JPEG", quality=85, optimize=True)
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            continue  # PDF, SVG ou arquivo inválido
        chave = f"especies/{especie.pk}.jpg"
        armazenamento.cliente_interno().put_object(
            Bucket=settings.S3_BUCKET, Key=chave, Body=saida.getvalue(), ContentType="image/jpeg"
        )
        return chave
    return ""


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
    especie.imagem_chave = _copiar_imagem(
        _sessao(), especie, resultado.campos.get("_imagem_fontes", [])
    )
    if especie.imagem_url and not especie.imagem_chave and armazenamento.s3_configurado():
        resultado.mensagem = " ".join(
            filter(None, [resultado.mensagem, "Imagem não copiada; exibida da Wikimedia."])
        )
    especie.referencias_mensagem = resultado.mensagem[:300]
    especie.referencias_consultadas_em = timezone.now()
    especie.save(
        update_fields=[
            *CAMPOS_REFERENCIA,
            "imagem_chave",
            "referencias_situacao",
            "referencias_mensagem",
            "referencias_consultadas_em",
            "atualizado_em",
        ]
    )
    return especie
