"""Dados que a simbologia do mapa usa: condição aparente nos tiles e rótulo dos bairros."""

import pytest
from django.contrib.gis.geos import Point

from itree.inventario.models import Arvore

from .conftest import PONTO_A
from .test_evidencias_mapa import _tile

pytestmark = pytest.mark.django_db


def test_tile_de_arvores_traz_condicao_aparente(cliente, revisor):
    r = cliente.como(revisor).post("/api/v1/arvores", {"localizacao": PONTO_A}, format="json")
    x, y = _tile(PONTO_A["longitude"], PONTO_A["latitude"], 17)
    url = f"/api/v1/mapa/tiles/arvores/17/{x}/{y}"
    # Sem inspeção validada: "nao_avaliada", nunca vazio.
    conteudo = cliente.get(url).content
    assert b"condicao" in conteudo and b"nao_avaliada" in conteudo
    Arvore.objects.filter(pk=r.json()["id"]).update(condicao_aparente="ruim")
    assert b"ruim" in cliente.get(url).content
    # Em zoom agrupado, a célula com uma só árvore traz as mesmas propriedades.
    x, y = _tile(PONTO_A["longitude"], PONTO_A["latitude"], 13)
    agrupado = cliente.get(f"/api/v1/mapa/tiles/arvores/13/{x}/{y}").content
    assert b"ruim" in agrupado and b"localizacao_origem" in agrupado


def test_geojson_de_bairros_traz_ponto_de_rotulo_dentro_do_poligono(cliente, revisor, territorios):
    corpo = cliente.como(revisor).get("/api/v1/territorios/geojson", {"tipo": "bairro"}).json()
    assert corpo["features"]
    for f in corpo["features"]:
        lon, lat = f["properties"]["rotulo"]
        assert territorios["a" if f["properties"]["nome"] == "Bairro A" else "b"].geom.contains(
            Point(lon, lat, srid=4326)
        )
