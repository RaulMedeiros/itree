"""Catálogo de espécies com referências externas (M-01), sem acessar a rede."""

import pytest
import requests

from itree.inventario import referencias, views
from itree.inventario.models import Arvore, Especie

from .conftest import PONTO_A, PONTO_B, com_escopo, criar_usuario

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
                        "thumburl": "https://upload.wikimedia.org/thumb/oiti.jpg",
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
    def __init__(self, dados, status=200):
        self.dados, self.status_code = dados, status

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
        raise AssertionError(url)


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
