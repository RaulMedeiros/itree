"""Filtro de bairro nos alertas (lista, contagem do painel e camada do mapa) e nas tarefas do mapa."""

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from itree.alertas import fontes
from itree.alertas.models import AlertaAmbiental
from itree.tarefas.models import Tarefa

from .conftest import PONTO_B, com_escopo, criar_usuario
from .test_evidencias_mapa import _tile
from .test_f3 import FOCOS

pytestmark = pytest.mark.django_db


@pytest.fixture
def analista(territorios):
    return com_escopo(
        criar_usuario("ana@itree.teste", ["analista_ambiental"]), territorios["municipio"]
    )


@pytest.fixture
def alertas(territorios):
    """F1 no Bairro A e F2 no Bairro B."""
    fontes.ingerir("inpe_focos", FOCOS.encode(), "focos.csv")
    return {a.id_externo: a for a in AlertaAmbiental.objects.all()}


def _externos(corpo):
    return {a["id_externo"] for a in corpo["results"]}


def test_lista_de_alertas_filtra_por_bairro(cliente, analista, alertas, territorios):
    cliente.como(analista)
    assert _externos(cliente.get("/api/v1/alertas").json()) == {"F1", "F2"}
    a = cliente.get("/api/v1/alertas", {"bairro": str(territorios["a"].id)}).json()
    assert _externos(a) == {"F1"} and a["count"] == 1
    b = cliente.get("/api/v1/alertas", {"bairro": str(territorios["b"].id)}).json()
    assert _externos(b) == {"F2"}
    assert cliente.get("/api/v1/alertas", {"bairro": "nao-e-uuid"}).status_code == 400


def test_camada_de_alertas_do_mapa_filtra_por_bairro(cliente, analista, alertas, territorios):
    cliente.como(analista)
    url = "/api/v1/mapa/alertas"
    assert len(cliente.get(url).json()["features"]) == 2
    corpo = cliente.get(url, {"bairro": str(territorios["b"].id)}).json()
    assert [f["properties"]["codigo"] for f in corpo["features"]] == [alertas["F2"].codigo]
    assert cliente.get(url, {"bairro": "nao-e-uuid"}).status_code == 400


def test_contagem_de_alertas_do_painel_filtra_por_bairro(cliente, analista, alertas, territorios):
    cliente.como(analista)
    url = "/api/v1/indicadores/painel"

    def quantidade(**filtros):
        pendencias = {p["id"]: p for p in cliente.get(url, filtros).json()["pendencias"]}
        return pendencias["alertas_detectados"]["quantidade"] if pendencias else 0

    assert quantidade() == 2
    assert quantidade(bairro=str(territorios["a"].id)) == 1


def _tarefa(ponto, usuario, **extras):
    from itree.inventario.models import Arvore

    geom = Point(ponto["longitude"], ponto["latitude"], srid=4326)
    return Tarefa.objects.create(
        tipo="inspecao_arvore",
        arvore=Arvore.objects.create(geom=geom),
        geom=geom,
        criada_por=usuario,
        prazo=timezone.localdate(),
        **extras,
    )


def test_tile_de_tarefas_filtra_por_bairro(cliente, gestor_municipal, territorios):
    _tarefa(PONTO_B, gestor_municipal)
    x, y = _tile(PONTO_B["longitude"], PONTO_B["latitude"], 17)
    url = f"/api/v1/mapa/tiles/tarefas/17/{x}/{y}"
    cliente.como(gestor_municipal)
    assert len(cliente.get(url).content) > 0
    assert len(cliente.get(url, {"bairro": str(territorios["b"].id)}).content) > 0
    assert len(cliente.get(url, {"bairro": str(territorios["a"].id)}).content) == 0
    assert cliente.get(url, {"bairro": "nao-e-uuid"}).status_code == 400
