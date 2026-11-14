"""Referências externas das espécies do catálogo (M-01).

O Wikidata é o ponto de partida: o item é localizado pelo nome científico
(propriedade P225, "nome do táxon") e só é aceito se esse nome for **igual**
ao do catálogo. Do item vêm os vínculos para a Wikipedia (pt, senão en), a
imagem no Wikimedia Commons (P18), o identificador do GBIF (P846) e o da
Flora e Funga do Brasil (P10701, "Reflora ID"). Se o item não tem link para a
Wikipedia, o artigo é procurado pelo nome científico, mas só é aceito se o
item do próprio artigo tiver P225 idêntico ao do catálogo ou se o artigo
declarar esse nome como sinônimo.

Nada é inventado ou completado por aproximação: sem item correspondente, a
espécie fica como "não encontrada"; uma imagem sem licença declarada não é
usada. Os textos e imagens são exibidos com fonte, licença e data de consulta.

Imagem: o Wikimedia Commons (P18) tem prioridade. Sem P18, sem licença
reconhecida ou com o Wikidata fora do ar, a imagem vem do GBIF (ocorrências com
foto), ver `_imagem_gbif`.
"""

import html
import io
import ipaddress
import re
import socket
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import quote, urljoin, urlsplit

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
GBIF_API = "https://api.gbif.org/v1"
# Flora e Funga do Brasil no Wikidata (observado em 2026-11): a propriedade é a
# P10701 ("Reflora ID"; formatter URL https://floradobrasil.jbrj.gov.br/$1;
# formato FB[0-9]{2,6}). Valores reais: Licania tomentosa Q9022290 = FB16857,
# Handroanthus impetiginosus Q3266951 = FB114086. O URL do modelo vem desse
# formatter (ver FLORA_BRASIL_URL em models.py).
PROPRIEDADE_FLORA_BRASIL = "P10701"
FORMATO_FLORA_BRASIL = re.compile(r"FB\d{2,6}")
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
    # Consulta que terminou com falha em uma fonte secundária (ex.: GBIF fora do
    # ar): o que foi obtido é gravado, mas a situação fica "erro" para o beat
    # tentar de novo.
    parcial: bool = False


def _sessao() -> requests.Session:
    s = requests.Session()
    # Política de uso da Wikimedia: identificar o cliente.
    s.headers["User-Agent"] = settings.REFERENCIAS_USER_AGENT
    return s


TAMANHO_MAXIMO_ORIGINAL = 30 * 1024 * 1024
LADO_MAXIMO_COPIA = 960
# Nova tentativa com espera crescente (2, 4, 8, 16 s), no mínimo o `Retry-After`
# da resposta. Com `Retry-After` acima de ESPERA_MAXIMA o trabalhador não fica
# preso esperando: a consulta termina em erro e o beat a retoma depois.
TENTATIVAS = 5
ESPERA_BASE = 2.0
ESPERA_MAXIMA = 60.0
STATUS_COM_NOVA_TENTATIVA = (429, 502, 503, 504)


def _esperar(segundos: float) -> None:
    time.sleep(segundos)


def _retry_after(resposta) -> float | None:
    """Segundos pedidos em `Retry-After` (número ou data HTTP); None se ausente."""
    valor = str(resposta.headers.get("Retry-After", "")).strip()
    if not valor:
        return None
    try:
        return max(float(valor), 0.0)
    except ValueError:
        pass
    try:
        data = parsedate_to_datetime(valor)
    except (TypeError, ValueError):
        return None
    if data.tzinfo is None:
        data = data.replace(tzinfo=UTC)
    return max((data - datetime.now(UTC)).total_seconds(), 0.0)


def _espera(tentativa: int, retry_after: float | None) -> float:
    """Espera antes da próxima tentativa: crescente, nunca menor que o Retry-After."""
    return min(max(ESPERA_BASE * 2 ** (tentativa - 1), retry_after or 0.0), ESPERA_MAXIMA)


def _json(sessao: requests.Session, url: str, **params) -> dict:
    """GET com JSON. 429 e 5xx transitórios têm nova tentativa com espera crescente
    (respeitando `Retry-After`) até TENTATIVAS; esgotadas, vira ErroConsulta."""
    host = url.split("/")[2]
    for tentativa in range(1, TENTATIVAS + 1):
        try:
            r = sessao.get(url, params=params or None, timeout=settings.REFERENCIAS_TIMEOUT)
        except requests.RequestException as exc:
            raise ErroConsulta(f"Falha de rede ao consultar {host}.") from exc
        if r.status_code in STATUS_COM_NOVA_TENTATIVA:
            pedida = _retry_after(r)
            if tentativa == TENTATIVAS or (pedida is not None and pedida > ESPERA_MAXIMA):
                motivo = (
                    f"{host} limitou as consultas (429)"
                    if r.status_code == 429
                    else f"{host} respondeu {r.status_code}"
                )
                detalhe = f", pedindo espera de {pedida:.0f} s" if pedida is not None else ""
                raise ErroConsulta(
                    f"{motivo} após {tentativa} tentativa(s){detalhe}; "
                    "nova tentativa automática mais tarde."
                )
            _esperar(_espera(tentativa, pedida))
            continue
        if r.status_code == 404:
            return {}
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
                _esperar(_espera(tentativa, None))
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
            if not entidade:
                continue
            nome_do_item = str(_valor(entidade, "P225") or "")
            if _normalizar(nome_do_item) == _normalizar(nome_cientifico):
                nota = ""
            elif nome_do_item and _lista_como_sinonimo(sessao, idioma, titulo, nome_cientifico):
                # O artigo trata do nome aceito e declara o do catálogo como sinônimo.
                nota = (
                    f"Artigo da Wikipedia sobre {nome_do_item}, que lista "
                    f"{nome_cientifico} como sinônimo."
                )
            else:
                continue
            artigo = _resumo_artigo(sessao, idioma, titulo)
            if artigo:
                return {**artigo, "nota": nota} if nota else artigo
    except ErroConsulta:
        return {}
    return {}


# Campo de sinônimos da caixa taxonômica (pt: Info/Taxonomia; en: Taxobox/Speciesbox).
_CAMPO_SINONIMOS = re.compile(
    r"^\s*\|\s*(?:sin[óô]nimos|synonyms)\s*=(.*?)(?=^\s*\||^\s*\}\})",
    re.IGNORECASE | re.MULTILINE | re.DOTALL,
)


def _sinonimos(wikitext: str) -> list[str]:
    """Nomes listados no campo de sinônimos, sem marcação nem autoria."""
    campo = _CAMPO_SINONIMOS.search(wikitext or "")
    if not campo:
        return []
    texto = re.sub(r"<[^>]+>", "\n", campo.group(1))
    texto = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", texto)
    texto = texto.replace("'", "")
    nomes = []
    for linha in re.split(r"[\n*;]", texto):
        palavras = linha.split()
        # Binômio (ou trinômio com var./subsp.) no início da entrada; o resto é autoria.
        if len(palavras) >= 2 and palavras[0][:1].isupper() and palavras[1][:1].islower():
            nome = palavras[:2]
            if len(palavras) >= 4 and palavras[2] in ("var.", "subsp.", "f."):
                nome = palavras[:4]
            nomes.append(" ".join(nome))
    return nomes


def _lista_como_sinonimo(
    sessao: requests.Session, idioma: str, titulo: str, nome_cientifico: str
) -> bool:
    """O artigo declara, na caixa taxonômica, o nome do catálogo como sinônimo?"""
    pagina = _json(
        sessao,
        WIKIPEDIA_API.format(idioma=idioma),
        action="parse",
        page=titulo,
        prop="wikitext",
        format="json",
        formatversion="2",
    )
    wikitext = pagina.get("parse", {}).get("wikitext", "")
    alvo = _normalizar(nome_cientifico)
    return any(_normalizar(n) == alvo for n in _sinonimos(wikitext))


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
            "imagem_fonte": FONTE_COMMONS,
            "_imagem_confiavel": True,
        }
    return {}


# --- Imagem alternativa: GBIF -------------------------------------------------
#
# Decisão de licenças (documentada também na spec, RN-INV-023): só entram
# licenças abertas declaradas pelo registro: CC0, CC BY e CC BY-SA, e CC BY-NC,
# esta só porque autor, licença (com link) e fonte ficam sempre visíveis ao lado
# da imagem e a plataforma é de uso público não comercial. Versões com
# restrição a obras derivadas (ND) e "todos os direitos reservados" são
# descartadas, assim como licença ausente ou desconhecida. A ordem de preferência
# é a da lista: a menos restritiva primeiro.
FONTE_COMMONS = "Wikimedia Commons"
_LICENCAS_GBIF = (
    # (padrão da URL da licença, rótulo, prefixo do link canônico)
    (
        re.compile(r"creativecommons\.org/publicdomain/zero/(\d\.\d)"),
        "CC0 {v}",
        "publicdomain/zero",
    ),
    (re.compile(r"creativecommons\.org/licenses/by/(\d\.\d)"), "CC BY {v}", "licenses/by"),
    (re.compile(r"creativecommons\.org/licenses/by-sa/(\d\.\d)"), "CC BY-SA {v}", "licenses/by-sa"),
    (re.compile(r"creativecommons\.org/licenses/by-nc/(\d\.\d)"), "CC BY-NC {v}", "licenses/by-nc"),
)
# Registros de observação (foto de campo) antes de espécime de herbário/museu.
_BASES_OBSERVACAO = {"HUMAN_OBSERVATION", "MACHINE_OBSERVATION", "OBSERVATION", "LIVING_SPECIMEN"}
_FORMATOS_IMAGEM = ("image/jpeg", "image/png", "image/webp")
LIMITE_OCORRENCIAS_GBIF = 300


def licenca_aberta(url: str) -> tuple[int, str, str] | None:
    """(posição na preferência, rótulo, link) de uma licença aceita; None se não for."""
    for posicao, (padrao, rotulo, caminho) in enumerate(_LICENCAS_GBIF):
        achado = padrao.search(str(url or "").lower())
        if achado:
            versao = achado.group(1)
            return (
                posicao,
                rotulo.format(v=versao),
                f"https://creativecommons.org/{caminho}/{versao}/",
            )
    return None


def _https(url: str) -> str:
    """O navegador só carrega imagem por https (CSP e conteúdo misto)."""
    return "https://" + url[len("http://") :] if url.lower().startswith("http://") else url


def _miniatura_gbif(url: str) -> str:
    """O GBIF só informa o original. Quando a origem oferece tamanho médio de forma
    documentada (iNaturalist: original -> medium), usa-se esse; senão, o original
    (a cópia local o reduz para 960 px)."""
    if "inaturalist-open-data.s3.amazonaws.com/photos/" in url:
        return url.replace("/original.", "/medium.")
    return url


def _url_http(valor) -> str:
    texto = str(valor or "").strip()
    return texto if urlsplit(texto).scheme in ("http", "https") else ""


def _candidata_gbif(registro: dict) -> dict | None:
    """Transforma uma ocorrência do GBIF em candidata, ou None se não servir
    (sem imagem utilizável, licença não aceita ou, quando a licença exige
    atribuição, sem autor)."""
    for media in registro.get("media") or []:
        identificador = _url_http(media.get("identifier"))
        formato = str(media.get("format") or "").lower()
        if not identificador or (formato and formato not in _FORMATOS_IMAGEM):
            continue
        licenca = licenca_aberta(media.get("license") or registro.get("license"))
        if licenca is None:
            continue
        posicao, rotulo, link = licenca
        autor = _texto_simples(
            media.get("rightsHolder")
            or media.get("creator")
            or registro.get("rightsHolder")
            or registro.get("recordedBy")
            or ""
        )
        # CC0 dispensa atribuição; as demais a exigem. Sem autor, não é usada.
        if not autor and posicao != 0:
            continue
        publicador = _texto_simples(
            media.get("publisher")
            or registro.get("datasetName")
            or registro.get("institutionCode")
            or ""
        )
        pagina = (
            _url_http(media.get("references"))
            or _url_http(registro.get("references"))
            or f"https://www.gbif.org/occurrence/{registro.get('key')}"
        )
        observacao = registro.get("basisOfRecord") in _BASES_OBSERVACAO
        return {
            "ordem": (0 if observacao else 1, posicao),
            "imagem_url": _https(_miniatura_gbif(identificador))[:1000],
            "_imagem_fontes": [
                _https(_miniatura_gbif(identificador)),
                _https(identificador),
                identificador,
            ],
            "imagem_pagina_url": pagina[:1000],
            "imagem_autor": autor[:300],
            "imagem_licenca": rotulo,
            "imagem_licenca_url": link,
            "imagem_fonte": (f"GBIF — {publicador}" if publicador else "GBIF")[:200],
            "_imagem_confiavel": False,
        }
    return None


def _chave_gbif(sessao: requests.Session, nome_cientifico: str, gbif_id) -> int | None:
    """Chave do táxon no GBIF: a do Wikidata (P846) ou, na falta, a do
    `species/match`, aceita só se o casamento for EXATO e o nome canônico igual ao
    do catálogo (nada por aproximação)."""
    if gbif_id:
        return int(gbif_id)
    achado = _json(sessao, f"{GBIF_API}/species/match", name=nome_cientifico, kingdom="Plantae")
    if (
        achado.get("matchType") == "EXACT"
        and _normalizar(str(achado.get("canonicalName", ""))) == _normalizar(nome_cientifico)
        and achado.get("usageKey")
    ):
        return int(achado["usageKey"])
    return None


def _imagem_gbif(sessao: requests.Session, nome_cientifico: str, gbif_id=None) -> dict:
    """Melhor imagem do GBIF para o táxon, ou {}. Usa `occurrence/search` com
    `mediaType=StillImage` (o `/species/{key}/media` vem vazio para quase todas as
    espécies do catálogo, verificado em 2026-11). Entre as candidatas, vale a de
    foto de campo (observação) sobre a de herbário e, dentro dessa, a licença
    menos restritiva (CC0, CC BY, CC BY-SA, CC BY-NC)."""
    chave = _chave_gbif(sessao, nome_cientifico, gbif_id)
    if chave is None:
        return {}
    dados = _json(
        sessao,
        f"{GBIF_API}/occurrence/search",
        taxonKey=chave,
        mediaType="StillImage",
        limit=LIMITE_OCORRENCIAS_GBIF,
    )
    candidatas = [c for r in dados.get("results", []) if (c := _candidata_gbif(r))]
    if not candidatas:
        return {}
    melhor = min(candidatas, key=lambda c: c["ordem"])  # empate: a primeira devolvida
    melhor.pop("ordem")
    return melhor


def consultar(nome_cientifico: str) -> Referencias:
    sessao = _sessao()
    entidade = localizar_item(sessao, nome_cientifico)
    if entidade is None:
        return Referencias(False, "Nenhum item do Wikidata com este nome científico exato (P225).")
    gbif = _valor(entidade, "P846")
    flora = str(_valor(entidade, PROPRIEDADE_FLORA_BRASIL) or "").strip()
    campos = {
        "wikidata_id": entidade["id"],
        # Só aceita o formato documentado; qualquer outra coisa é descartada.
        "flora_brasil_id": flora if FORMATO_FLORA_BRASIL.fullmatch(flora) else "",
        "gbif_id": int(gbif) if gbif and str(gbif).isdigit() else None,
        **_wikipedia(sessao, entidade, nome_cientifico),
        **_imagem(sessao, entidade),
    }
    erro_gbif = ""
    if not campos.get("imagem_url"):
        # Sem imagem no Commons (sem P18 ou sem licença): tenta o GBIF.
        try:
            campos.update(_imagem_gbif(sessao, nome_cientifico, campos["gbif_id"]))
        except ErroConsulta as exc:
            erro_gbif = str(exc)
    nota = campos.pop("nota", "")
    faltando = [
        nome
        for nome, chave in (("artigo na Wikipedia", "wikipedia_url"), ("imagem", "imagem_url"))
        if not campos.get(chave)
    ]
    sem = f"Sem {' nem '.join(faltando)}." if faltando else ""
    mensagem = " ".join(parte for parte in (nota, sem, erro_gbif) if parte)[:300]
    return Referencias(True, mensagem, campos, parcial=bool(erro_gbif))


CAMPOS_REFERENCIA = (
    "wikidata_id",
    "wikipedia_idioma",
    "wikipedia_titulo",
    "wikipedia_url",
    "wikipedia_descricao",
    "wikipedia_resumo",
    "gbif_id",
    "flora_brasil_id",
    "imagem_url",
    "imagem_pagina_url",
    "imagem_autor",
    "imagem_licenca",
    "imagem_licenca_url",
    "imagem_fonte",
)


MAX_REDIRECIONAMENTOS = 3


def _host_publico(url: str) -> bool:
    """O endereço aponta só para a internet pública? As URLs de imagem do GBIF vêm
    de terceiros: sem esta checagem, o servidor poderia ser levado a buscar
    endereços internos (SSRF)."""
    partes = urlsplit(url)
    if partes.scheme not in ("http", "https") or not partes.hostname:
        return False
    try:
        enderecos = {i[4][0] for i in socket.getaddrinfo(partes.hostname, partes.port or 443)}
    except OSError:
        return False
    return bool(enderecos) and all(ipaddress.ip_address(e).is_global for e in enderecos)


def _baixar(sessao: requests.Session, url: str, confiavel: bool = True) -> bytes | None:
    """Baixa a imagem. Redirecionamentos são seguidos à mão (até 3) e, quando a URL
    não é de uma fonte confiável (Wikimedia), cada endereço é validado."""
    for _ in range(MAX_REDIRECIONAMENTOS + 1):
        if not confiavel and not _host_publico(url):
            return None
        r = None
        for tentativa in range(1, TENTATIVAS + 1):
            try:
                r = sessao.get(url, timeout=settings.REFERENCIAS_TIMEOUT * 4, allow_redirects=False)
            except requests.RequestException:
                return None
            if r.status_code in STATUS_COM_NOVA_TENTATIVA and tentativa < TENTATIVAS:
                pedida = _retry_after(r)
                if pedida is not None and pedida > ESPERA_MAXIMA:
                    return None  # limite longo: tenta a próxima fonte
                _esperar(_espera(tentativa, pedida))
                continue
            break
        if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("Location"):
            url = urljoin(url, r.headers["Location"])
            continue
        if r.status_code != 200 or len(r.content) > TAMANHO_MAXIMO_ORIGINAL:
            return None
        return r.content
    return None


def _copiar_imagem(
    sessao: requests.Session, especie: Especie, fontes: list[str], confiavel: bool = True
) -> str:
    """Baixa a imagem (miniatura padrão, senão o original), reduz para no
    máximo 960 px e guarda um JPEG no armazenamento da plataforma. Devolve a
    chave, ou "" se não for possível (o painel então exibe a miniatura da
    origem)."""
    if not fontes or not armazenamento.s3_configurado():
        return ""
    for url in fontes:
        conteudo = _baixar(sessao, url, confiavel)
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


CAMPOS_IMAGEM = (
    "imagem_url",
    "imagem_pagina_url",
    "imagem_autor",
    "imagem_licenca",
    "imagem_licenca_url",
    "imagem_fonte",
)


def _registrar_erro(especie: Especie, exc: ErroConsulta) -> Especie:
    """Wikidata (ou Commons) fora do ar: registra o erro, mantém o que já havia e,
    se a espécie ainda não tem imagem, tenta o GBIF. O beat retoma depois e, havendo
    imagem no Commons, ela passa a valer (prioridade)."""
    mensagem = str(exc)
    campos_gravados = []
    if not especie.imagem_url:
        try:
            imagem = _imagem_gbif(_sessao(), especie.nome_cientifico, especie.gbif_id)
        except ErroConsulta:
            imagem = {}
        if imagem:
            for campo in CAMPOS_IMAGEM:
                setattr(especie, campo, imagem.get(campo, ""))
            especie.imagem_chave = _copiar_imagem(
                _sessao(),
                especie,
                imagem.get("_imagem_fontes", []),
                imagem.get("_imagem_confiavel", False),
            )
            campos_gravados = [*CAMPOS_IMAGEM, "imagem_chave"]
            mensagem = f"{mensagem} Imagem obtida do GBIF."
    especie.referencias_situacao = SituacaoReferencias.ERRO
    especie.referencias_mensagem = mensagem[:300]
    especie.referencias_consultadas_em = timezone.now()
    especie.save(
        update_fields=[
            *campos_gravados,
            "referencias_situacao",
            "referencias_mensagem",
            "referencias_consultadas_em",
            "atualizado_em",
        ]
    )
    return especie


def atualizar(especie: Especie) -> Especie:
    """Consulta e grava as referências. Em erro de rede, mantém as anteriores
    (e tenta a imagem do GBIF se não houver nenhuma)."""
    try:
        resultado = consultar(especie.nome_cientifico)
    except ErroConsulta as exc:
        return _registrar_erro(especie, exc)

    for campo in CAMPOS_REFERENCIA:
        padrao = None if campo == "gbif_id" else ""
        setattr(especie, campo, resultado.campos.get(campo, padrao) or padrao)
    if resultado.parcial:
        especie.referencias_situacao = SituacaoReferencias.ERRO
    elif resultado.encontrada:
        especie.referencias_situacao = SituacaoReferencias.ENCONTRADAS
    else:
        especie.referencias_situacao = SituacaoReferencias.NAO_ENCONTRADAS
    especie.imagem_chave = _copiar_imagem(
        _sessao(),
        especie,
        resultado.campos.get("_imagem_fontes", []),
        resultado.campos.get("_imagem_confiavel", True),
    )
    if especie.imagem_url and not especie.imagem_chave and armazenamento.s3_configurado():
        resultado.mensagem = " ".join(
            filter(None, [resultado.mensagem, "Imagem não copiada; exibida da origem."])
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
