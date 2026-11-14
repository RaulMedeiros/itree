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
        # Formato real observado no Wikidata (P10701, "Reflora ID"): FB + dígitos
        # (Licania tomentosa Q9022290 = FB16857).
        "P10701": [{"mainsnak": {"datavalue": {"value": "FB16857"}}}],
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

    gbif_ocorrencias: list = ()
    gbif_match: dict = {"matchType": "NONE"}

    def get(self, url, params=None, timeout=None, **_):
        self.urls.append(url)
        self.params = getattr(self, "params", []) + [params or {}]
        if self.falhar:
            raise requests.ConnectionError("sem rede")
        if "api.gbif.org" in url:
            if url.endswith("/species/match"):
                return Resposta(self.gbif_match)
            return Resposta({"results": list(self.gbif_ocorrencias)})
        if "fotos.exemplo.org" in url:
            return Resposta({}, 200, {}, self.original)
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


@pytest.fixture(autouse=True)
def _hosts_publicos(monkeypatch):
    """Sem DNS nos testes: todo endereço conta como público."""
    monkeypatch.setattr(referencias, "_host_publico", lambda url: True)


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
    assert oiti.imagem_fonte == "Wikimedia Commons"
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

    def com_limite(url, params=None, timeout=None, **_):
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
        def get(self, url, params=None, timeout=None, **_):
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
        def get(self, url, params=None, timeout=None, **_):
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

    def __init__(self, busca=BUSCA_PT_REAL, itens=None, busca_erro=False, wikitextos=None, **kw):
        super().__init__(item=ITEM_SEM_LINK, **kw)
        self.busca, self.itens, self.busca_erro = busca, itens or {}, busca_erro
        self.wikitextos = wikitextos or {}
        self.consultados = []

    def get(self, url, params=None, timeout=None):
        if "wikipedia.org/w/api.php" in url:
            self.urls.append(url)
            self.params = getattr(self, "params", []) + [params or {}]
            if self.busca_erro:
                return Resposta({"error": {"code": "internal_api_error", "info": "x"}})
            if (params or {}).get("action") == "parse":
                titulo = params["page"]
                return Resposta(
                    {"parse": {"title": titulo, "wikitext": self.wikitextos.get(titulo, "")}}
                )
            if url.startswith("https://pt."):
                return Resposta(self.busca)
            return Resposta({"batchcomplete": ""})  # en: sem resultados
        if "Special:EntityData" in url:
            qid = url.rsplit("/", 1)[1].removesuffix(".json")
            if qid in self.itens:
                self.consultados.append(qid)
                return Resposta({"entities": {qid: self.itens[qid]}})
        return super().get(url, params, timeout)


# Trecho real da caixa taxonômica do artigo "Oiti" (pt.wikipedia.org, action=parse):
# o artigo trata de Moquilea tomentosa e lista Licania tomentosa como sinônimo.
WIKITEXT_OITI_REAL = """{{Info/Taxonomia
| nome = Oiti
| imagem = Licania tomentosa.JPG
| família = [[Chrysobalanaceae]]
| género = ''[[Moquilea]]''
| espécie = ''M. tomentosa''
| binomial = ''Moquilea tomentosa''
| binomial_autoridade = (Benth.) Fritsch
| sinónimos = ''Licania tomentosa'' Benth.<br>
''Pleragina odorata'' Arruda da Gama ex Koster
<center>
}}
O oiti é uma árvore..."""


def test_artigo_aceito_pelo_nome_identico_no_item(oiti, monkeypatch):
    itens = {"Q85192266": _item_p225("Q85192266", "Licania tomentosa")}
    s = SessaoBusca(itens=itens)
    monkeypatch.setattr(referencias, "_sessao", lambda: s)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.wikipedia_titulo == "Oiti" and oiti.referencias_mensagem == ""
    assert not any(p.get("action") == "parse" for p in s.params)  # nome idêntico basta


def test_artigo_encontrado_pela_busca_quando_o_item_nao_tem_link(oiti, monkeypatch):
    """Caso real: o item do artigo "Oiti" (Q85192266) tem P225 "Moquilea tomentosa",
    e a caixa taxonômica do artigo lista "Licania tomentosa" como sinônimo."""
    itens = {"Q85192266": _item_p225("Q85192266", "Moquilea tomentosa")}
    s = SessaoBusca(itens=itens, wikitextos={"Oiti": WIKITEXT_OITI_REAL})
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
    assert oiti.referencias_mensagem == (
        "Artigo da Wikipedia sobre Moquilea tomentosa, que lista Licania tomentosa como sinônimo."
    )


def test_candidato_com_nome_diferente_e_rejeitado(oiti, monkeypatch):
    """Nome diferente no item e o artigo não declara o do catálogo como sinônimo
    (ex.: trata de outro táxon): não é aceito."""
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


def test_sinonimos_lidos_da_caixa_taxonomica():
    assert referencias._sinonimos(WIKITEXT_OITI_REAL) == ["Licania tomentosa", "Pleragina odorata"]
    en = "{{Speciesbox\n| genus = Moquilea\n| synonyms =\n* ''Licania tomentosa'' (Benth.) Fritsch\n}}"
    assert referencias._sinonimos(en) == ["Licania tomentosa"]
    assert referencias._sinonimos("{{Info/Taxonomia\n| nome = X\n}}") == []


def test_flora_e_funga_do_brasil_vem_da_propriedade_do_wikidata(oiti, sessao):
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.flora_brasil_id == "FB16857"
    # Formatter URL da P10701: https://floradobrasil.jbrj.gov.br/$1
    assert oiti.flora_brasil_url == "https://floradobrasil.jbrj.gov.br/FB16857"


def test_sem_propriedade_ou_formato_invalido_nao_ha_link(oiti, monkeypatch):
    sem = {**ITEM, "claims": {k: v for k, v in ITEM["claims"].items() if k != "P10701"}}
    monkeypatch.setattr(referencias, "_sessao", lambda: Sessao(item=sem))
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.flora_brasil_id == "" and oiti.flora_brasil_url == ""

    invalido = {
        **ITEM,
        "claims": {**ITEM["claims"], "P10701": [{"mainsnak": {"datavalue": {"value": "xyz"}}}]},
    }
    monkeypatch.setattr(referencias, "_sessao", lambda: Sessao(item=invalido))
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.flora_brasil_id == ""


def test_api_expoe_link_da_flora_e_funga_do_brasil(cliente, revisor, oiti, sessao):
    referencias.atualizar(oiti)
    r = cliente.como(revisor).get(f"/api/v1/especies/{oiti.pk}")
    assert r.status_code == 200
    assert r.json()["flora_brasil_url"] == "https://floradobrasil.jbrj.gov.br/FB16857"
    assert r.json()["flora_brasil_id"] == "FB16857"


def test_tarefa_mensal_esta_agendada_no_dia_1_de_madrugada(settings):
    from celery.schedules import crontab

    from config import settings as config_settings

    agenda = config_settings.CELERY_BEAT_SCHEDULE["atualizar-referencias-especies"]
    assert agenda["task"] == "itree.inventario.tasks.atualizar_referencias_antigas"
    assert agenda["schedule"] == crontab(minute=30, hour=3, day_of_month=1)


def _especie(nome, consultada_em=None, **extra):
    return Especie.objects.create(
        nome_cientifico=nome, referencias_consultadas_em=consultada_em, **extra
    )


def test_tarefa_seleciona_so_antigas_ou_nunca_consultadas(monkeypatch, settings):
    from datetime import timedelta

    from django.utils import timezone

    from itree.inventario import tasks

    settings.REFERENCIAS_IDADE_MAXIMA_DIAS = 30
    settings.REFERENCIAS_INTERVALO_SEGUNDOS = 0
    agora = timezone.now()
    _especie("Antiga a", agora - timedelta(days=31))
    _especie("Nunca b")
    _especie("Recente c", agora - timedelta(days=5))
    _especie("Inativa d", agora - timedelta(days=90), ativa=False)
    vistas = []
    monkeypatch.setattr(referencias, "atualizar", lambda e: vistas.append(e.nome_cientifico) or e)
    monkeypatch.setattr(tasks.time, "sleep", lambda s: None)
    resultado = tasks.atualizar_referencias_antigas()
    assert sorted(vistas) == ["Antiga a", "Nunca b"]
    assert resultado == {"selecionadas": 2, "atualizadas": 2, "falhas": 0}


def test_tarefa_nao_para_quando_uma_especie_falha(monkeypatch, settings):
    from itree.inventario import tasks

    settings.REFERENCIAS_INTERVALO_SEGUNDOS = 0.5
    for nome in ("A", "B", "C"):
        _especie(nome)
    vistas, pausas = [], []

    def atualizar(especie):
        vistas.append(especie.nome_cientifico)
        if especie.nome_cientifico == "B":
            raise RuntimeError("falha inesperada")
        return especie

    monkeypatch.setattr(referencias, "atualizar", atualizar)
    monkeypatch.setattr(tasks.time, "sleep", pausas.append)
    resultado = tasks.atualizar_referencias_antigas()
    assert vistas == ["A", "B", "C"]
    assert resultado == {"selecionadas": 3, "atualizadas": 2, "falhas": 1}
    assert pausas == [0.5, 0.5]  # intervalo entre consultas, não antes da primeira


# --- Resiliência: espera crescente, Retry-After e limite de tentativas ---


class Limitada(Sessao):
    """Wikidata responde 429 nas primeiras `n` buscas (ou sempre, com n=None)."""

    def __init__(self, n=None, cabecalhos=None, status=429, **kw):
        super().__init__(**kw)
        self.n, self.cabecalhos, self.status, self.buscas = n, cabecalhos or {}, status, 0

    def get(self, url, params=None, timeout=None, **kw):
        if "wikidata.org/w/api.php" in url:
            self.buscas += 1
            if self.n is None or self.buscas <= self.n:
                return Resposta({}, self.status, self.cabecalhos)
        return super().get(url, params, timeout, **kw)


def test_espera_cresce_a_cada_tentativa_sem_retry_after(oiti, monkeypatch):
    esperas = []
    monkeypatch.setattr(referencias, "_esperar", esperas.append)
    sessao = Limitada(n=4)
    monkeypatch.setattr(referencias, "_sessao", lambda: sessao)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert esperas == [2.0, 4.0, 8.0, 16.0]
    assert oiti.referencias_situacao == "encontradas"


def test_retry_after_maior_que_a_espera_crescente_prevalece(oiti, monkeypatch):
    esperas = []
    monkeypatch.setattr(referencias, "_esperar", esperas.append)
    monkeypatch.setattr(
        referencias, "_sessao", lambda: Limitada(n=2, cabecalhos={"Retry-After": "20"})
    )
    referencias.atualizar(oiti)
    assert esperas == [20.0, 20.0]


def test_retry_after_em_data_http_e_respeitado(oiti, monkeypatch):
    from datetime import UTC, datetime, timedelta
    from email.utils import format_datetime

    esperas = []
    monkeypatch.setattr(referencias, "_esperar", esperas.append)
    data = format_datetime(datetime.now(UTC) + timedelta(seconds=30), usegmt=True)
    monkeypatch.setattr(
        referencias, "_sessao", lambda: Limitada(n=1, cabecalhos={"Retry-After": data})
    )
    referencias.atualizar(oiti)
    assert 25 <= esperas[0] <= 30


def test_limite_de_tentativas_e_erro_com_mensagem_clara(oiti, monkeypatch):
    esperas = []
    monkeypatch.setattr(referencias, "_esperar", esperas.append)
    sessao = Limitada()
    monkeypatch.setattr(referencias, "_sessao", lambda: sessao)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert sessao.buscas == referencias.TENTATIVAS == 5
    assert len(esperas) == 4
    assert oiti.referencias_situacao == "erro"
    assert (
        "wikidata.org limitou as consultas (429) após 5 tentativa(s)" in oiti.referencias_mensagem
    )
    assert "nova tentativa automática" in oiti.referencias_mensagem


def test_retry_after_muito_longo_nao_prende_o_trabalhador(oiti, monkeypatch):
    esperas = []
    monkeypatch.setattr(referencias, "_esperar", esperas.append)
    sessao = Limitada(cabecalhos={"Retry-After": "3600"})
    monkeypatch.setattr(referencias, "_sessao", lambda: sessao)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert sessao.buscas == 1 and esperas == []
    assert oiti.referencias_situacao == "erro"
    assert "pedindo espera de 3600 s" in oiti.referencias_mensagem


def test_indisponibilidade_503_tambem_tem_nova_tentativa(oiti, monkeypatch):
    esperas = []
    monkeypatch.setattr(referencias, "_esperar", esperas.append)
    monkeypatch.setattr(referencias, "_sessao", lambda: Limitada(n=1, status=503))
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert esperas == [2.0] and oiti.referencias_situacao == "encontradas"


def test_beat_diario_retoma_so_as_com_erro_antigas(monkeypatch, settings):
    from datetime import timedelta

    from celery.schedules import crontab
    from django.utils import timezone

    from config import settings as config_settings
    from itree.inventario import tasks

    settings.REFERENCIAS_REPETIR_ERRO_HORAS = 12
    settings.REFERENCIAS_INTERVALO_SEGUNDOS = 0
    agora = timezone.now()
    _especie("Erro antigo", agora - timedelta(hours=13), referencias_situacao="erro")
    _especie("Erro recente", agora - timedelta(hours=1), referencias_situacao="erro")
    _especie("Encontrada", agora - timedelta(days=2), referencias_situacao="encontradas")
    vistas = []
    monkeypatch.setattr(referencias, "atualizar", lambda e: vistas.append(e.nome_cientifico) or e)
    monkeypatch.setattr(tasks.time, "sleep", lambda s: None)
    assert tasks.retomar_referencias_com_erro()["selecionadas"] == 1
    assert vistas == ["Erro antigo"]
    agenda = config_settings.CELERY_BEAT_SCHEDULE["retomar-referencias-com-erro"]
    assert agenda["task"] == "itree.inventario.tasks.retomar_referencias_com_erro"
    assert agenda["schedule"] == crontab(minute=45, hour=5)


def test_reconsulta_mensal_inclui_erro_mesmo_recente(monkeypatch, settings):
    from datetime import timedelta

    from django.utils import timezone

    from itree.inventario import tasks

    settings.REFERENCIAS_INTERVALO_SEGUNDOS = 0
    _especie("Erro recente", timezone.now() - timedelta(hours=1), referencias_situacao="erro")
    vistas = []
    monkeypatch.setattr(referencias, "atualizar", lambda e: vistas.append(e.nome_cientifico) or e)
    tasks.atualizar_referencias_antigas()
    assert vistas == ["Erro recente"]


# --- Imagem alternativa: GBIF ---


def _ocorrencia(
    chave=1,
    licenca="http://creativecommons.org/licenses/by/4.0/",
    autor="Beltrano",
    base="HUMAN_OBSERVATION",
    publicador="iNaturalist",
    identificador="https://fotos.exemplo.org/1/original.jpg",
    **media,
):
    return {
        "key": chave,
        "basisOfRecord": base,
        "datasetName": "Observações",
        "media": [
            {
                "type": "StillImage",
                "format": "image/jpeg",
                "identifier": identificador,
                "license": licenca,
                "rightsHolder": autor,
                "publisher": publicador,
                "references": f"https://exemplo.org/fotos/{chave}",
                **media,
            }
        ],
    }


@pytest.fixture
def sem_p18(monkeypatch):
    """Wikidata sem P18; o GBIF é configurado pelo teste."""
    claims = {k: v for k, v in ITEM["claims"].items() if k != "P18"}

    def montar(ocorrencias=(), match=None, **kw):
        s = Sessao(item={**ITEM, "claims": claims}, **kw)
        s.gbif_ocorrencias = list(ocorrencias)
        if match is not None:
            s.gbif_match = match
        monkeypatch.setattr(referencias, "_sessao", lambda: s)
        return s

    return montar


def test_sem_p18_a_imagem_vem_do_gbif_com_atribuicao_completa(oiti, sem_p18):
    s = sem_p18(
        [
            _ocorrencia(
                identificador="https://inaturalist-open-data.s3.amazonaws.com/photos/9/original.jpg"
            )
        ]
    )
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.referencias_situacao == "encontradas"
    assert oiti.imagem_url == "https://inaturalist-open-data.s3.amazonaws.com/photos/9/medium.jpg"
    assert oiti.imagem_autor == "Beltrano"
    assert oiti.imagem_licenca == "CC BY 4.0"
    assert oiti.imagem_licenca_url == "https://creativecommons.org/licenses/by/4.0/"
    assert oiti.imagem_pagina_url == "https://exemplo.org/fotos/1"
    assert oiti.imagem_fonte == "GBIF — iNaturalist"
    busca = next(p for p in s.params if p.get("mediaType"))
    assert busca["taxonKey"] == 5583617  # a chave P846 do Wikidata, sem chamar o match
    assert not any(u.endswith("/species/match") for u in s.urls)
    assert "Sem imagem" not in oiti.referencias_mensagem


def test_commons_tem_prioridade_sobre_o_gbif(oiti, monkeypatch):
    s = Sessao()
    s.gbif_ocorrencias = [_ocorrencia()]
    monkeypatch.setattr(referencias, "_sessao", lambda: s)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.imagem_fonte == "Wikimedia Commons" and oiti.imagem_autor == "Fulana de Tal"
    assert not any("api.gbif.org" in u for u in s.urls)


def test_commons_sem_licenca_cai_no_gbif(oiti, monkeypatch):
    sem_licenca = {"query": {"pages": {"1": {"imageinfo": [{"thumburl": "x", "extmetadata": {}}]}}}}
    s = Sessao(imagem=sem_licenca)
    s.gbif_ocorrencias = [_ocorrencia()]
    monkeypatch.setattr(referencias, "_sessao", lambda: s)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.imagem_fonte == "GBIF — iNaturalist"


@pytest.mark.parametrize(
    "licenca",
    [
        "",
        None,
        "http://creativecommons.org/licenses/by-nd/4.0/",
        "http://creativecommons.org/licenses/by-nc-sa/4.0/",
        "http://creativecommons.org/licenses/by-nc-nd/4.0/",
        "All rights reserved",
        "http://exemplo.org/licenca-propria",
    ],
)
def test_licenca_nao_aberta_ou_desconhecida_descarta_a_imagem(oiti, sem_p18, licenca):
    sem_p18([_ocorrencia(licenca=licenca)])
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.imagem_url == "" and oiti.imagem_fonte == ""
    assert oiti.referencias_mensagem == "Sem imagem."


def test_licencas_aceitas_e_rotulos():
    aceitas = {
        "http://creativecommons.org/publicdomain/zero/1.0/legalcode": "CC0 1.0",
        "https://creativecommons.org/licenses/by/4.0/": "CC BY 4.0",
        "http://creativecommons.org/licenses/by-sa/3.0/legalcode": "CC BY-SA 3.0",
        "http://creativecommons.org/licenses/by-nc/4.0/legalcode": "CC BY-NC 4.0",
    }
    for url, rotulo in aceitas.items():
        assert referencias.licenca_aberta(url)[1] == rotulo
    assert referencias.licenca_aberta("http://creativecommons.org/licenses/by-nd/4.0/") is None


def test_imagem_com_atribuicao_exigida_sem_autor_e_descartada_mas_cc0_nao(oiti, sem_p18):
    sem_p18([_ocorrencia(autor="")])
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.imagem_url == ""
    cc0 = _ocorrencia(
        autor="", licenca="http://creativecommons.org/publicdomain/zero/1.0/legalcode"
    )
    sem_p18([cc0])
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.imagem_licenca == "CC0 1.0" and oiti.imagem_autor == ""


def test_escolha_prefere_foto_de_campo_e_licenca_menos_restritiva(oiti, sem_p18):
    nc = "http://creativecommons.org/licenses/by-nc/4.0/"
    cc0 = "http://creativecommons.org/publicdomain/zero/1.0/"
    sem_p18(
        [
            _ocorrencia(1, licenca=cc0, base="PRESERVED_SPECIMEN"),
            _ocorrencia(2, licenca=nc),
            _ocorrencia(3, licenca="http://creativecommons.org/licenses/by-sa/4.0/"),
            _ocorrencia(4, licenca="http://creativecommons.org/licenses/by/4.0/"),
        ]
    )
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    # Foto de campo vence herbário; entre as de campo, CC BY vence CC BY-SA e BY-NC.
    assert oiti.imagem_pagina_url == "https://exemplo.org/fotos/4"
    assert oiti.imagem_licenca == "CC BY 4.0"


def test_cc_by_nc_so_e_aceita_com_a_licenca_gravada_para_exibicao(oiti, sem_p18):
    sem_p18([_ocorrencia(licenca="http://creativecommons.org/licenses/by-nc/4.0/legalcode")])
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.imagem_licenca == "CC BY-NC 4.0"
    assert oiti.imagem_licenca_url == "https://creativecommons.org/licenses/by-nc/4.0/"


def test_gbif_sem_chave_no_wikidata_usa_o_match_exato(oiti, monkeypatch):
    item = {**ITEM, "claims": {k: v for k, v in ITEM["claims"].items() if k not in ("P18", "P846")}}
    s = Sessao(item=item)
    s.gbif_ocorrencias = [_ocorrencia()]
    s.gbif_match = {"matchType": "EXACT", "canonicalName": "Licania tomentosa", "usageKey": 2985499}
    monkeypatch.setattr(referencias, "_sessao", lambda: s)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert next(p for p in s.params if p.get("mediaType"))["taxonKey"] == 2985499
    assert oiti.imagem_fonte == "GBIF — iNaturalist"
    assert oiti.gbif_id is None  # o vínculo só vem do Wikidata, não do match


@pytest.mark.parametrize(
    "match",
    [
        {"matchType": "FUZZY", "canonicalName": "Licania tomentosa", "usageKey": 1},
        {"matchType": "HIGHERRANK", "canonicalName": "Licania", "usageKey": 2},
        {"matchType": "EXACT", "canonicalName": "Licania outra", "usageKey": 3},
        {"matchType": "NONE"},
    ],
)
def test_match_aproximado_do_gbif_nao_gera_imagem(oiti, monkeypatch, match):
    item = {**ITEM, "claims": {k: v for k, v in ITEM["claims"].items() if k not in ("P18", "P846")}}
    s = Sessao(item=item)
    s.gbif_ocorrencias = [_ocorrencia()]
    s.gbif_match = match
    monkeypatch.setattr(referencias, "_sessao", lambda: s)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.imagem_url == ""
    assert not any("occurrence/search" in u for u in s.urls)


def test_wikidata_fora_do_ar_registra_erro_e_busca_imagem_no_gbif(oiti, monkeypatch):
    monkeypatch.setattr(referencias, "_esperar", lambda s: None)
    s = Limitada()
    s.gbif_ocorrencias = [_ocorrencia()]
    s.gbif_match = {"matchType": "EXACT", "canonicalName": "Licania tomentosa", "usageKey": 2985499}
    monkeypatch.setattr(referencias, "_sessao", lambda: s)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.referencias_situacao == "erro"
    assert (
        "429" in oiti.referencias_mensagem and "Imagem obtida do GBIF" in oiti.referencias_mensagem
    )
    assert oiti.imagem_fonte == "GBIF — iNaturalist" and oiti.imagem_licenca == "CC BY 4.0"


def test_erro_no_wikidata_nao_troca_imagem_ja_existente(oiti, sessao, monkeypatch):
    referencias.atualizar(oiti)  # imagem do Commons
    monkeypatch.setattr(referencias, "_esperar", lambda s: None)
    s = Limitada()
    s.gbif_ocorrencias = [_ocorrencia()]
    monkeypatch.setattr(referencias, "_sessao", lambda: s)
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.referencias_situacao == "erro"
    assert oiti.imagem_fonte == "Wikimedia Commons" and oiti.imagem_autor == "Fulana de Tal"


def test_gbif_fora_do_ar_grava_o_resto_e_deixa_em_erro_para_nova_tentativa(
    oiti, monkeypatch, sem_p18
):
    monkeypatch.setattr(referencias, "_esperar", lambda s: None)

    class GbifCaido(Sessao):
        def get(self, url, params=None, timeout=None, **kw):
            if "api.gbif.org" in url:
                return Resposta({}, 503)
            return super().get(url, params, timeout, **kw)

    claims = {k: v for k, v in ITEM["claims"].items() if k != "P18"}
    monkeypatch.setattr(referencias, "_sessao", lambda: GbifCaido(item={**ITEM, "claims": claims}))
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.referencias_situacao == "erro"
    assert oiti.wikipedia_url == "https://pt.wikipedia.org/wiki/Oiti"  # o que veio foi gravado
    assert "api.gbif.org respondeu 503" in oiti.referencias_mensagem


def test_copia_local_da_imagem_do_gbif_e_reduzida(oiti, sem_p18, s3):  # noqa: F811
    import io

    from PIL import Image

    sem_p18([_ocorrencia()])
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.imagem_chave == f"especies/{oiti.pk}.jpg"
    with Image.open(
        io.BytesIO(s3.get_object(Bucket="itree-teste", Key=oiti.imagem_chave)["Body"].read())
    ) as img:
        assert img.size == (960, 720)
    assert oiti.imagem_fonte == "GBIF — iNaturalist"  # a atribuição acompanha a cópia


def test_endereco_interno_de_imagem_do_gbif_nao_e_baixado(oiti, sem_p18, s3, monkeypatch):  # noqa: F811
    monkeypatch.setattr(referencias, "_host_publico", lambda url: False)
    s = sem_p18([_ocorrencia()])
    referencias.atualizar(oiti)
    oiti.refresh_from_db()
    assert oiti.imagem_chave == ""
    assert not any("fotos.exemplo.org" in u for u in s.urls)


def test_host_publico_recusa_enderecos_internos(monkeypatch):
    monkeypatch.undo()  # volta ao teste real, sem o autouse
    for url in (
        "http://127.0.0.1/x.jpg",
        "http://localhost/x.jpg",
        "file:///etc/passwd",
        "http://[::1]/x",
    ):
        assert referencias._host_publico(url) is False


def test_api_expoe_a_fonte_da_imagem(cliente, revisor, oiti, sem_p18):
    sem_p18([_ocorrencia()])
    referencias.atualizar(oiti)
    dados = cliente.como(revisor).get(f"/api/v1/especies/{oiti.id}").json()
    assert dados["imagem_fonte"] == "GBIF — iNaturalist"
    assert dados["imagem_licenca_url"].startswith("https://creativecommons.org/")


def test_migracao_marca_imagens_antigas_como_do_commons(oiti):
    from importlib import import_module

    from django.apps import apps

    migracao = import_module("itree.inventario.migrations.0010_imagem_fonte_especie")
    Especie.objects.filter(pk=oiti.pk).update(imagem_url="https://x/y.jpg", imagem_fonte="")
    migracao.preencher_fonte_das_imagens_antigas(apps, None)
    oiti.refresh_from_db()
    assert oiti.imagem_fonte == "Wikimedia Commons"
