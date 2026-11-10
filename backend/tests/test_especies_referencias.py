"""Catálogo de espécies com referências externas (M-01), sem acessar a rede."""

import pytest
import requests

from itree.inventario import referencias, views
from itree.inventario.models import Arvore, Especie

from .conftest import PONTO_A, PONTO_B, com_escopo, criar_usuario
from .test_evidencias_mapa import s3  # noqa: F401 - fixture

pytestmark = pytest.mark.django_db

ITEM = {
    "id": "Q1234",
    "claims": {
        "P225": [{"mainsnak": {"datavalue": {"value": "Licania tomentosa"}}}],
        "P18": [{"mainsnak": {"datavalue": {"value": "Oiti em Fortaleza.jpg"}}}],
        "P846": [{"mainsnak": {"datavalue": {"value": "5583617"}}}],
    },
    "sitelinks": {"ptwiki": {"title": "Oiti"}, "enwiki": {"title": "Licania tomentosa"}},
}
RESUMO = {
    "type": "standard",
    "title": "Oiti",
    "description": "espécie de planta",
    "extract": "O oiti é uma árvore da família Chrysobalanaceae.",
    "content_urls": {"desktop": {"page": "https://pt.wikipedia.org/wiki/Oiti"}},
}
IMAGEM = {
    "query": {
        "pages": {
            "1": {
                "imageinfo": [
                    {
                        "url": "https://upload.wikimedia.org/original/oiti.jpg",
                        "thumburl": "https://thumb.wikimedia.org/thumb/oiti.jpg",
                        "descriptionurl": "https://commons.wikimedia.org/wiki/File:Oiti.jpg",
                        "extmetadata": {
                            "Artist": {"value": '<a href="//x">Fulana de Tal</a>'},
                            "LicenseShortName": {"value": "CC BY-SA 4.0"},
                            "LicenseUrl": {
                                "value": "https://creativecommons.org/licenses/by-sa/4.0"
                            },
                        },
                    }
                ]
            }
        }
    }
}


class Resposta:
    def __init__(self, dados, status=200, headers=None, conteudo=b""):
        self.dados, self.status_code, self.headers = dados, status, headers or {}
        self.content = conteudo

    def json(self):
        return self.dados


class Sessao:
    """Responde como as APIs da Wikimedia, com variações por cenário."""

    def __init__(self, item=ITEM, resumos=None, imagem=IMAGEM, falhar=False):
        self.item, self.imagem, self.falhar = item, imagem, falhar
        self.resumos = {"pt": RESUMO} if resumos is None else resumos
        self.headers = {}
        self.urls = []

    def get(self, url, params=None, timeout=None):
        self.urls.append(url)
        self.params = getattr(self, "params", []) + [params or {}]
        if self.falhar:
            raise requests.ConnectionError("sem rede")
        if "w/api.php" in url and "wikidata" in url:
            return Resposta({"query": {"search": [{"title": self.item["id"]}]}})
        if "Special:EntityData" in url:
            return Resposta({"entities": {self.item["id"]: self.item}})
        if "wikipedia.org" in url:
            idioma = url.split("//")[1].split(".")[0]
            resumo = self.resumos.get(idioma)
            return Resposta(resumo or {}, 200 if resumo else 404)
        if "commons" in url:
            return Resposta(self.imagem)
        if "thumb.wikimedia.org" in url:
            if self.miniatura_limitada:
                return Resposta({}, 429, {"Retry-After": "600"})
            return Resposta({}, 200, {}, self.original)
        if "upload.wikimedia.org" in url:
            return Resposta({}, 200, {}, self.original)
        raise AssertionError(url)

    original = None  # definido abaixo (imagem 2000x1500)
    miniatura_limitada = False


def _png(largura, altura) -> bytes:
    import io

    from PIL import Image

    saida = io.BytesIO()
    Image.new("RGB", (largura, altura), (30, 120, 60)).save(saida, "PNG")
    return saida.getvalue()


Sessao.original = _png(2000, 1500)


@pytest.fixture
def sessao(monkeypatch):
    s = Sessao()
    monkeypatch.setattr(referencias, "_sessao", lambda: s)
    return s


@pytest.fixture
def oiti(db):
    return Especie.objects.create(
        nome_cientifico="Licania tomentosa", familia="Chrysobalanaceae", nomes_comuns=["Oiti"]
    )


def test_referencias_encontradas_com_fonte_e_licenca(oiti, sessao):
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.referencias_situacao == "encontradas"
    assert oiti.wikidata_id == "Q1234" and oiti.gbif_id == 5583617
    assert oiti.gbif_url == "https://www.gbif.org/species/5583617"
    assert (oiti.wikipedia_idioma, oiti.wikipedia_url) == (
        "pt",
        "https://pt.wikipedia.org/wiki/Oiti",
    )
    assert oiti.wikipedia_resumo.startswith("O oiti")
    assert oiti.imagem_licenca == "CC BY-SA 4.0" and oiti.imagem_autor == "Fulana de Tal"
    assert oiti.referencias_consultadas_em is not None
    # Campos taxonômicos mantidos pela administração não mudam.
    assert (oiti.familia, oiti.nomes_comuns) == ("Chrysobalanaceae", ["Oiti"])


def test_cliente_se_identifica_para_a_wikimedia(settings):
    settings.REFERENCIAS_USER_AGENT = "itree-teste/1.0 (https://exemplo)"
    assert referencias._sessao().headers["User-Agent"] == "itree-teste/1.0 (https://exemplo)"


def test_item_com_nome_diferente_nao_e_aceito(oiti, monkeypatch):
    genero = {**ITEM, "claims": {"P225": [{"mainsnak": {"datavalue": {"value": "Licania"}}}]}}
    monkeypatch.setattr(referencias, "_sessao", lambda: Sessao(item=genero))
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.referencias_situacao == "nao_encontradas"
    assert oiti.wikidata_id == "" and oiti.wikipedia_url == "" and oiti.imagem_url == ""


def test_imagem_sem_licenca_nao_e_usada_e_wikipedia_en_como_alternativa(oiti, monkeypatch):
    sem_licenca = {"query": {"pages": {"1": {"imageinfo": [{"thumburl": "x", "extmetadata": {}}]}}}}
    resumo_en = {**RESUMO, "content_urls": {"desktop": {"page": "https://en.wikipedia.org/x"}}}
    monkeypatch.setattr(
        referencias, "_sessao", lambda: Sessao(resumos={"en": resumo_en}, imagem=sem_licenca)
    )
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.referencias_situacao == "encontradas"
    assert oiti.wikipedia_idioma == "en" and oiti.imagem_url == ""
    assert oiti.referencias_mensagem == "Sem imagem."


def test_erro_de_rede_preserva_referencias_anteriores(oiti, sessao, monkeypatch):
    referencias.atualizar(oiti)
    monkeypatch.setattr(referencias, "_sessao", lambda: Sessao(falhar=True))
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.referencias_situacao == "erro"
    assert "Falha de rede" in oiti.referencias_mensagem
    assert oiti.wikipedia_url == "https://pt.wikipedia.org/wiki/Oiti"


def test_api_atualiza_referencias_so_para_administracao(cliente, admin, revisor, oiti, sessao):
    url = f"/api/v1/especies/{oiti.id}/atualizar-referencias"
    assert cliente.como(revisor).post(url).status_code == 403
    r = cliente.como(admin).post(url)
    assert r.status_code == 200, r.json()
    assert r.json()["wikipedia_url"] == "https://pt.wikipedia.org/wiki/Oiti"
    # Referências não são editáveis à mão pela API.
    cliente.patch(f"/api/v1/especies/{oiti.id}", {"wikipedia_url": "https://x.y"}, format="json")
    oiti.refresh_from_db()
    assert oiti.wikipedia_url == "https://pt.wikipedia.org/wiki/Oiti"


def test_contagem_de_arvores_respeita_escopo(cliente, revisor, territorios, oiti):
    ipe = Especie.objects.create(nome_cientifico="Handroanthus impetiginosus")
    for ponto, especie in ((PONTO_A, oiti), (PONTO_A, oiti), (PONTO_B, oiti), (PONTO_B, ipe)):
        r = cliente.como(revisor).post(
            "/api/v1/arvores", {"localizacao": ponto, "especie_id": str(especie.id)}, format="json"
        )
        assert r.status_code == 201, r.json()
    so_a = com_escopo(criar_usuario("a@itree.teste", ["consulta"]), territorios["a"])
    corpo = cliente.como(so_a).get("/api/v1/especies", {"ordem": "arvores"}).json()
    contagem = {e["nome_cientifico"]: e["arvores_no_escopo"] for e in corpo["results"]}
    assert contagem == {"Licania tomentosa": 2, "Handroanthus impetiginosus": 0}
    corpo = cliente.get("/api/v1/especies", {"com_arvores": "true"}).json()
    assert [e["nome_cientifico"] for e in corpo["results"]] == ["Licania tomentosa"]


def test_ficha_da_arvore_traz_cartao_da_especie(cliente, revisor, oiti, sessao):
    referencias.atualizar(oiti)
    r = cliente.como(revisor).post(
        "/api/v1/arvores", {"localizacao": PONTO_A, "especie_id": str(oiti.id)}, format="json"
    )
    cartao = cliente.get(f"/api/v1/arvores/{r.json()['id']}").json()["especie_cartao"]
    assert cartao["imagem_licenca"] == "CC BY-SA 4.0"
    assert cartao["wikipedia_url"].startswith("https://pt.wikipedia.org")
    assert Arvore.objects.get().especie_id == oiti.id


def test_cadastro_enfileira_consulta(
    cliente, admin, settings, monkeypatch, django_capture_on_commit_callbacks
):
    settings.REFERENCIAS_AUTOMATICAS = True
    enfileiradas = []
    monkeypatch.setattr(views, "_enfileirar_referencias", enfileiradas.append)
    with django_capture_on_commit_callbacks(execute=True):
        r = cliente.como(admin).post(
            "/api/v1/especies", {"nome_cientifico": "Cassia fistula"}, format="json"
        )
    assert r.status_code == 201
    assert [str(i) for i in enfileiradas] == [r.json()["id"]]


def test_respeita_limite_de_taxa_da_wikimedia(oiti, sessao, monkeypatch):
    esperas = []
    monkeypatch.setattr(referencias, "_esperar", esperas.append)
    original = sessao.get
    limitadas = {"n": 0}

    def com_limite(url, params=None, timeout=None):
        if "wikipedia.org" in url and limitadas["n"] < 2:
            limitadas["n"] += 1
            return Resposta({}, 429, {"Retry-After": "17"})
        return original(url, params, timeout)

    sessao.get = com_limite
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert esperas == [17.0, 17.0]
    assert oiti.referencias_situacao == "encontradas" and oiti.wikipedia_url


def test_limite_persistente_vira_erro_explicito(oiti, monkeypatch):
    monkeypatch.setattr(referencias, "_esperar", lambda s: None)

    class SempreLimitada(Sessao):
        def get(self, url, params=None, timeout=None):
            return Resposta({}, 429, {"Retry-After": "999"})

    monkeypatch.setattr(referencias, "_sessao", lambda: SempreLimitada())
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.referencias_situacao == "erro"
    assert "429" in oiti.referencias_mensagem


def test_busca_no_wikidata_usa_sintaxe_exata_do_haswbstatement(oiti, sessao):
    referencias.atualizar(oiti)
    busca = next(p for p in sessao.params if p.get("list") == "search")
    assert busca["srsearch"] == 'haswbstatement:"P225=Licania tomentosa"'


def test_erro_da_api_com_status_200_nao_vira_nao_encontrada(oiti, monkeypatch):
    """O MediaWiki responde 200 com {"error": ...}; isso é erro, não ausência."""
    monkeypatch.setattr(referencias, "_esperar", lambda s: None)

    class ApiComErro(Sessao):
        def get(self, url, params=None, timeout=None):
            return Resposta({"error": {"code": "ratelimited", "info": "too many"}})

    monkeypatch.setattr(referencias, "_sessao", lambda: ApiComErro())
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.referencias_situacao == "erro"
    assert "ratelimited" in oiti.referencias_mensagem


def test_imagem_copiada_reduzida_para_o_armazenamento_e_servida_localmente(
    cliente,
    revisor,
    oiti,
    sessao,
    s3,  # noqa: F811
):
    import io

    from PIL import Image

    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.imagem_chave == f"especies/{oiti.pk}.jpg"
    copia = s3.get_object(Bucket="itree-teste", Key=oiti.imagem_chave)
    assert copia["ContentType"] == "image/jpeg"
    with Image.open(io.BytesIO(copia["Body"].read())) as imagem:
        assert imagem.size == (960, 720)  # reduzida, proporção mantida
    url = cliente.como(revisor).get(f"/api/v1/especies/{oiti.id}").json()["imagem_url"]
    assert oiti.imagem_chave in url and "wikimedia.org" not in url
    assert oiti.imagem_autor == "Fulana de Tal"  # crédito continua vindo da fonte


def test_arquivo_que_nao_e_imagem_nao_e_copiado(oiti, sessao, s3):  # noqa: F811
    sessao.original = b"%PDF-1.4 exsicata"
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.imagem_chave == ""
    assert oiti.imagem_url.startswith("https://thumb.wikimedia.org")
    assert "Imagem não copiada" in oiti.referencias_mensagem


def test_miniatura_com_limite_longo_usa_o_original(oiti, sessao, s3, monkeypatch):  # noqa: F811
    esperas = []
    monkeypatch.setattr(referencias, "_esperar", esperas.append)
    sessao.miniatura_limitada = True
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.imagem_chave == f"especies/{oiti.pk}.jpg"
    assert esperas == []  # não espera 10 minutos: passa para a próxima fonte
    assert any("upload.wikimedia.org" in u for u in sessao.urls)


# --- M-10: artigo da Wikipedia pelo nome científico (item sem sitelink) ---

# Item real do táxon (Q9022290): sem sitelinks para a Wikipedia.
ITEM_SEM_LINK = {**ITEM, "id": "Q9022290", "sitelinks": {"commonswiki": {"title": "Category:x"}}}


def _pagina(pid, titulo, indice, qid=None, desambiguacao=False):
    props = {}
    if qid:
        props["wikibase_item"] = qid
    if desambiguacao:
        props["disambiguation"] = ""
    pagina = {"pageid": pid, "ns": 0, "title": titulo, "index": indice}
    return {**pagina, "pageprops": props} if props else pagina


def _item_p225(qid, nome):
    return {"id": qid, "claims": {"P225": [{"mainsnak": {"datavalue": {"value": nome}}}]}}


# Formato real de pt.wikipedia.org (generator=search + prop=pageprops) para
# "Licania tomentosa": o dicionário não vem ordenado; vale o campo "index".
BUSCA_PT_REAL = {
    "batchcomplete": "",
    "continue": {"gsroffset": 5, "continue": "gsroffset||"},
    "query": {
        "pages": {
            "254469": _pagina(254469, "Chrysobalanaceae", 2, "Q614604"),
            "375766": _pagina(375766, "Licania", 3, "Q135759"),
            "37855": _pagina(37855, "Lista de frutas", 5, "Q497975"),
            "6341672": _pagina(6341672, "Lista de frutas comestíveis da Amazônia", 4, "Q98670563"),
            "622599": _pagina(622599, "Oiti", 1, "Q85192266"),
        }
    },
}


class SessaoBusca(Sessao):
    """Item sem link para a Wikipedia; a busca por nome devolve candidatos."""

    def __init__(self, busca=BUSCA_PT_REAL, itens=None, busca_erro=False, **kw):
        super().__init__(item=ITEM_SEM_LINK, **kw)
        self.busca, self.itens, self.busca_erro = busca, itens or {}, busca_erro
        self.consultados = []

    def get(self, url, params=None, timeout=None):
        if "wikipedia.org/w/api.php" in url:
            self.urls.append(url)
            self.params = getattr(self, "params", []) + [params or {}]
            if self.busca_erro:
                return Resposta({"error": {"code": "internal_api_error", "info": "x"}})
            if url.startswith("https://pt."):
                return Resposta(self.busca)
            return Resposta({"batchcomplete": ""})  # en: sem resultados
        if "Special:EntityData" in url:
            qid = url.rsplit("/", 1)[1].removesuffix(".json")
            if qid in self.itens:
                self.consultados.append(qid)
                return Resposta({"entities": {qid: self.itens[qid]}})
        return super().get(url, params, timeout)


def test_artigo_encontrado_pela_busca_quando_o_item_nao_tem_link(oiti, monkeypatch):
    itens = {"Q85192266": _item_p225("Q85192266", "Licania tomentosa")}
    s = SessaoBusca(itens=itens)
    monkeypatch.setattr(referencias, "_sessao", lambda: s)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.wikidata_id == "Q9022290" and oiti.gbif_id == 5583617
    assert (oiti.wikipedia_idioma, oiti.wikipedia_titulo) == ("pt", "Oiti")
    assert oiti.wikipedia_url == "https://pt.wikipedia.org/wiki/Oiti"
    assert oiti.imagem_licenca == "CC BY-SA 4.0"
    busca = next(p for p in s.params if p.get("generator") == "search")
    assert busca["gsrsearch"] == "Licania tomentosa" and busca["gsrlimit"] == 5
    assert busca["prop"] == "pageprops" and busca["ppprop"] == "wikibase_item|disambiguation"
    # A busca respeita a relevância ("index"): o primeiro candidato é o "Oiti".
    assert s.consultados == ["Q85192266"]


def test_candidato_com_nome_diferente_e_rejeitado(oiti, monkeypatch):
    """Caso real observado: o item do artigo "Oiti" (Q85192266) tem P225
    "Moquilea tomentosa" (sinônimo), não o nome do catálogo; não é aceito."""
    itens = {
        "Q85192266": _item_p225("Q85192266", "Moquilea tomentosa"),
        "Q614604": _item_p225("Q614604", "Chrysobalanaceae"),
        "Q135759": _item_p225("Q135759", "Licania"),
        "Q497975": {"id": "Q497975", "claims": {}},
        "Q98670563": {"id": "Q98670563", "claims": {}},
    }
    s = SessaoBusca(itens=itens)
    monkeypatch.setattr(referencias, "_sessao", lambda: s)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.referencias_situacao == "encontradas"
    assert oiti.wikipedia_url == "" and oiti.wikipedia_resumo == ""
    assert oiti.referencias_mensagem == "Sem artigo na Wikipedia."
    assert oiti.imagem_licenca == "CC BY-SA 4.0" and oiti.gbif_id == 5583617
    assert len(s.consultados) == 5  # no máximo 5 candidatos


def test_desambiguacao_e_rejeitada(oiti, monkeypatch):
    busca = {
        "query": {"pages": {"1": _pagina(1, "Oiti (desambiguação)", 1, "Q1", desambiguacao=True)}}
    }
    # Mesmo com P225 idêntico, a página de desambiguação não é aceita.
    s = SessaoBusca(busca=busca, itens={"Q1": _item_p225("Q1", "Licania tomentosa")})
    monkeypatch.setattr(referencias, "_sessao", lambda: s)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert any(p.get("generator") == "search" for p in s.params)  # a busca ocorreu
    assert oiti.wikipedia_url == "" and s.consultados == []


def test_erro_da_busca_nao_derruba_imagem_e_gbif(oiti, monkeypatch):
    monkeypatch.setattr(referencias, "_esperar", lambda s: None)
    s = SessaoBusca(busca_erro=True)
    monkeypatch.setattr(referencias, "_sessao", lambda: s)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert any(p.get("generator") == "search" for p in s.params)  # a busca falhou
    assert oiti.referencias_situacao == "encontradas"
    assert oiti.wikipedia_url == "" and oiti.referencias_mensagem == "Sem artigo na Wikipedia."
    assert oiti.gbif_id == 5583617 and oiti.imagem_licenca == "CC BY-SA 4.0"
