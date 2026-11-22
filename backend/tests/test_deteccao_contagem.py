"""Indicadores com total e confirmadas: parâmetro `contagem`, helper reutilizável e consultas."""

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.exceptions import ValidationError

from itree.indicadores import contagem as cont
from itree.indicadores import populacao_indicadores as pi
from itree.inventario.models import Arvore

from .conftest import com_escopo, criar_usuario
from .test_populacao import cidade, dados  # noqa: F401 - cenário de população e árvores

pytestmark = pytest.mark.django_db


@pytest.fixture
def detectadas(dados):  # noqa: F811
    """Das 4 árvores de Aldeota, 3 são detecções não confirmadas; Centro tem 1 confirmada."""
    ids = list(
        Arvore.objects.filter(bairro=dados["a"]).order_by("numero").values_list("pk", flat=True)
    )
    Arvore.objects.filter(pk__in=ids[:3]).update(
        confirmada=False, origem_registro="deteccao_video", confianca=0.6
    )
    return dados


@pytest.fixture
def gestor(detectadas):
    return com_escopo(criar_usuario("g@itree.teste", ["gestor"]), detectadas["municipio"])


# --- Helper ---------------------------------------------------------------------------------


def test_validar_aceita_so_todas_ou_confirmadas():
    assert cont.validar(None) == cont.validar("") == "todas"
    assert cont.validar("confirmadas") == "confirmadas"
    with pytest.raises(ValidationError):
        cont.validar("outras")


def test_totais_e_por_grupo_usam_uma_so_consulta(detectadas):
    with CaptureQueriesContext(connection) as q:
        assert cont.totais(Arvore.objects.all()) == (5, 2)
    assert len(q) == 1
    with CaptureQueriesContext(connection) as q:
        por = cont.por_grupo(Arvore.objects.all(), "bairro_id")
    assert len(q) == 1
    assert por[detectadas["a"].pk] == (4, 1) and por[detectadas["b"].pk] == (1, 1)


def test_filtrar_e_escolher(detectadas):
    assert cont.filtrar(Arvore.objects.all(), "todas").count() == 5
    assert cont.filtrar(Arvore.objects.all(), "confirmadas").count() == 2
    assert (cont.escolher(5, 2, "todas"), cont.escolher(5, 2, "confirmadas")) == (5, 2)
    assert cont.rotulo(1234, 56) == "1.234 árvores (56 confirmadas)"
    assert cont.rotulo(1, 1) == "1 árvore (1 confirmada)"
    assert cont.rotulo(0, 0) == "0 árvores (0 confirmadas)"


# --- População: árvores por 1.000 habitantes ------------------------------------------------


def test_quadro_traz_as_duas_contagens_e_calcula_pela_escolhida(detectadas):
    todas = {x["nome"]: x for x in pi.quadro(None)}
    conf = {x["nome"]: x for x in pi.quadro(None, contagem="confirmadas")}
    a = todas["Aldeota"]
    assert (a["arvores"], a["arvores_total"], a["arvores_confirmadas"]) == (4, 4, 1)
    assert a["por_mil"] == pytest.approx(1000 * 4 / 42580, abs=0.01)
    b = conf["Aldeota"]
    assert (b["arvores"], b["arvores_total"], b["arvores_confirmadas"]) == (1, 4, 1)
    assert b["por_mil"] == pytest.approx(1000 * 1 / 42580, abs=0.01)
    assert b["hab_por_arvore"] == pytest.approx(42580, abs=0.1)


def test_quadro_continua_com_numero_fixo_de_consultas(detectadas):
    with CaptureQueriesContext(connection) as q1:
        pi.quadro(None)
    Arvore.objects.filter(bairro=detectadas["b"]).update(confirmada=False)
    with CaptureQueriesContext(connection) as q2:
        pi.quadro(None, contagem="confirmadas")
    assert len(q1) == len(q2)


def test_endpoint_de_populacao_segue_a_contagem(cliente, gestor):
    url = "/api/v1/indicadores/externos/populacao"
    por_nome = lambda r: {f["properties"]["nome"]: f["properties"] for f in r["features"]}  # noqa: E731
    todas = por_nome(cliente.como(gestor).get(url).json())["Aldeota"]
    conf = por_nome(cliente.get(url, {"contagem": "confirmadas"}).json())["Aldeota"]
    assert (todas["arvores"], todas["arvores_total"], todas["arvores_confirmadas"]) == (4, 4, 1)
    assert (conf["arvores"], conf["arvores_total"]) == (1, 4)
    assert conf["arvores_por_mil"] < todas["arvores_por_mil"]
    assert cliente.get(url, {"contagem": "x"}).status_code == 400


# --- Visão geral ----------------------------------------------------------------------------


def indicador(corpo, id_):
    return next(i for i in corpo["indicadores"] if i["id"] == id_)


def test_visao_geral_mostra_total_e_confirmadas(cliente, gestor):
    r = cliente.como(gestor).get("/api/v1/indicadores/painel")
    assert r.status_code == 200, r.json()
    validas = indicador(r.json(), "arvores_validas")
    assert (validas["valor"], validas["total"], validas["confirmadas"]) == (5, 5, 2)
    assert validas["rotulo_contagem"] == "5 árvores (2 confirmadas)"
    assert r.json()["filtros"]["contagem"] == "todas"


def test_visao_geral_so_confirmadas_afeta_os_indicadores(cliente, gestor):
    r = cliente.como(gestor).get("/api/v1/indicadores/painel", {"contagem": "confirmadas"})
    corpo = r.json()
    validas = indicador(corpo, "arvores_validas")
    assert (validas["valor"], validas["total"], validas["confirmadas"]) == (2, 5, 2)
    assert indicador(corpo, "arvores_registros")["valor"] == 2
    assert corpo["filtros"]["contagem"] == "confirmadas"
    por_mil = next(i for i in corpo["contexto_externo"] if i["id"] == "arvores_por_mil_habitantes")
    assert (por_mil["numerador"], por_mil["arvores_total"]) == (2, 5)
    assert cliente.get("/api/v1/indicadores/painel", {"contagem": "?"}).status_code == 400


# --- Ficha do bairro ------------------------------------------------------------------------


def cartao(corpo, id_):
    return next(c for c in corpo["cartoes"] if c["id"] == id_)


def test_ficha_do_bairro_mostra_n_arvores_m_confirmadas(cliente, gestor, detectadas):
    url = f"/api/v1/bairros/{detectadas['a'].pk}/ficha"
    corpo = cliente.como(gestor).get(url).json()
    arvores = cartao(corpo, "arvores")
    assert arvores["valor"] == 4 and "4 árvores (1 confirmada)" in arvores["detalhe"]
    assert {e["rotulo"]: e["valor"] for e in arvores["extras"]} == {
        "Todas": "4",
        "Confirmadas": "1",
    }
    conf = cliente.get(url, {"contagem": "confirmadas"}).json()
    assert cartao(conf, "arvores")["valor"] == 1
    assert "4 árvores (1 confirmada)" in cartao(conf, "arvores")["detalhe"]  # as duas, sempre
    assert cartao(conf, "arvores_por_mil")["valor"] < cartao(corpo, "arvores_por_mil")["valor"]
    assert "4 árvores (1 confirmada)" in cartao(corpo, "arvores_por_mil")["detalhe"]


# --- Análises -------------------------------------------------------------------------------

ANALISE = "/api/v1/relatorios/analise"


def test_analise_de_arvores_por_bairro_traz_as_duas_contagens(cliente, gestor):
    r = cliente.como(gestor).get(ANALISE, {"analise": "arvores_por_bairro"}).json()
    linha = next(x for x in r["linhas"] if x["rotulo"] == "Aldeota")
    assert (linha["valor"], linha["total"], linha["confirmadas"]) == (4, 4, 1)
    assert r["contagem"] == "todas" and r["total"] == 5
    conf = cliente.get(ANALISE, {"analise": "arvores_por_bairro", "contagem": "confirmadas"}).json()
    linha = next(x for x in conf["linhas"] if x["rotulo"] == "Aldeota")
    assert (linha["valor"], linha["total"], linha["confirmadas"]) == (1, 4, 1)
    assert conf["contagem"] == "confirmadas" and conf["total"] == 2
    assert {c["chave"] for c in conf["colunas_csv"]} >= {"valor", "total", "confirmadas"}


def test_analise_por_mil_e_dispersao_seguem_a_contagem(cliente, gestor):
    a = "arvores_por_mil_habitantes_por_bairro"
    todas = cliente.como(gestor).get(ANALISE, {"analise": a}).json()
    conf = cliente.get(ANALISE, {"analise": a, "contagem": "confirmadas"}).json()
    ald = lambda r: next(x for x in r["linhas"] if x["rotulo"] == "Aldeota")  # noqa: E731
    assert ald(conf)["valor"] < ald(todas)["valor"]
    assert "(1 confirmada)" in ald(conf)["detalhe"]
    assert conf["contagem"] == "confirmadas"
    sem = cliente.get(ANALISE, {"analise": "populacao_densidade_por_bairro"}).json()
    assert sem["contagem"] is None  # análise que não conta árvores


# --- Onde plantar ---------------------------------------------------------------------------


def test_onde_plantar_traz_as_contagens_e_segue_a_escolha(cliente, gestor, detectadas):
    url = "/api/v1/planejamento/criterios"
    todas = cliente.como(gestor).get(url).json()
    conf = cliente.get(url, {"contagem": "confirmadas"}).json()
    assert (todas["contagem"], conf["contagem"]) == ("todas", "confirmadas")
    ald = lambda r: next(b for b in r["bairros"] if b["nome"] == "Aldeota")  # noqa: E731
    assert (ald(todas)["arvores"], ald(todas)["arvores_confirmadas"]) == (4, 1)
    assert ald(conf)["valores"]["arvores_por_mil"] < ald(todas)["valores"]["arvores_por_mil"]
    assert cliente.get(url, {"contagem": "x"}).status_code == 400
