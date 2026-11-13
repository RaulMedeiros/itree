"""Árvores agrupadas por bairro em zoom afastado (M-29).

Abaixo do zoom 12, o tile de árvores traz um grupo por bairro, no ponto interior do polígono,
com a contagem, a pior condição e o nome do bairro, em vez de células. A partir do zoom 12,
voltam as células.
"""

import pytest
from django.contrib.gis.geos import MultiPolygon, Point, Polygon

from itree.inventario.models import Arvore
from itree.mapa.views import ZOOM_AGRUPA_BAIRRO

from .conftest import PONTO_A, PONTO_B, com_escopo, criar_territorio, criar_usuario
from .mvt_util import decodificar
from .test_evidencias_mapa import _tile

pytestmark = pytest.mark.django_db


def _arvore(lon, lat, condicao=""):
    return Arvore.objects.create(geom=Point(lon, lat, srid=4326), condicao_aparente=condicao)


def _arvores(cliente, z, lon, lat, **filtros):
    x, y = _tile(lon, lat, z)
    r = cliente.get(f"/api/v1/mapa/tiles/arvores/{z}/{x}/{y}", filtros)
    assert r.status_code == 200
    return decodificar(r.content, z, x, y).get("arvores", [])


def test_o_zoom_de_corte_e_12():
    assert ZOOM_AGRUPA_BAIRRO == 12


def test_um_grupo_por_bairro_com_contagem_pior_condicao_e_nome(cliente, revisor, territorios):
    for condicao in ("boa", "ruim", "morta"):
        _arvore(PONTO_A["longitude"], PONTO_A["latitude"], condicao)
    for condicao in ("regular", "boa"):
        _arvore(PONTO_B["longitude"], PONTO_B["latitude"], condicao)
    feicoes = _arvores(cliente.como(revisor), 10, PONTO_A["longitude"], PONTO_A["latitude"])
    grupos = {f["props"]["bairro"]: f["props"] for f in feicoes}
    assert set(grupos) == {"Bairro A", "Bairro B"}
    assert (grupos["Bairro A"]["quantidade"], grupos["Bairro A"]["pior_condicao"]) == (3, "morta")
    assert (grupos["Bairro B"]["quantidade"], grupos["Bairro B"]["pior_condicao"]) == (2, "regular")
    # Grupo de bairro não leva propriedades de árvore individual.
    assert all("condicao" not in f["props"] and "numero" not in f["props"] for f in feicoes)


def test_bairro_com_uma_so_arvore_continua_sendo_grupo_com_o_nome(cliente, revisor, territorios):
    _arvore(PONTO_A["longitude"], PONTO_A["latitude"], "ruim")
    (grupo,) = _arvores(cliente.como(revisor), 10, PONTO_A["longitude"], PONTO_A["latitude"])
    # Sem o nome do bairro, a tela a desenharia como árvore no ponto do bairro.
    assert grupo["props"]["bairro"] == "Bairro A" and grupo["props"]["quantidade"] == 1
    assert "id" not in grupo["props"]


def test_o_grupo_fica_no_ponto_interior_mesmo_com_bairro_em_c(cliente, revisor, territorios):
    # Bairro em "C": o centroide cai no vazio, fora do polígono.
    c = Polygon(
        (
            (-38.70, -3.80),
            (-38.60, -3.80),
            (-38.60, -3.78),
            (-38.68, -3.78),
            (-38.68, -3.72),
            (-38.60, -3.72),
            (-38.60, -3.70),
            (-38.70, -3.70),
            (-38.70, -3.80),
        )
    )
    bairro = criar_territorio("Bairro C", geom=MultiPolygon(c, srid=4326))
    assert not bairro.geom.contains(bairro.geom.centroid)
    _arvore(-38.69, -3.79, "boa")
    _arvore(-38.69, -3.71, "boa")
    gestor = com_escopo(criar_usuario("gc@itree.teste", ["gestor"]), bairro)
    (grupo,) = _arvores(cliente.como(gestor), 10, -38.69, -3.75)
    assert grupo["props"]["quantidade"] == 2
    assert bairro.geom.contains(Point(*grupo["ponto"], srid=4326))


def test_a_contagem_e_do_bairro_inteiro_e_so_um_tile_desenha_o_grupo(cliente, territorios):
    # Bairro largo (0,4 grau), que passa de um tile para outro no zoom 10 (0,35 grau).
    largo = criar_territorio(
        "Largo", geom=MultiPolygon(Polygon.from_bbox((-38.90, -3.95, -38.50, -3.85)), srid=4326)
    )
    for lon in (-38.89, -38.88, -38.52):
        _arvore(lon, -3.9, "regular")
    api = cliente.como(com_escopo(criar_usuario("gl@itree.teste", ["gestor"]), largo))
    achados = []
    for lon in (-38.89, -38.52):
        achados += [f for f in _arvores(api, 10, lon, -3.9) if f["props"].get("bairro") == "Largo"]
    # O grupo aparece num tile só e traz as 3 árvores, e não as que caem naquele tile.
    assert [f["props"]["quantidade"] for f in achados] == [3]


def test_arvore_sem_bairro_nao_some_e_segue_em_celula(cliente, revisor, territorios):
    _arvore(-38.57, -3.75, "ruim")  # dentro do município, fora dos dois bairros
    feicoes = _arvores(cliente.como(revisor), 10, -38.57, -3.75)
    assert [f["props"].get("bairro") for f in feicoes] == [None]
    assert feicoes[0]["props"]["quantidade"] == 1 and feicoes[0]["props"]["condicao"] == "ruim"


def test_a_partir_do_zoom_12_voltam_as_celulas(cliente, revisor, territorios):
    for _ in range(3):
        _arvore(PONTO_A["longitude"], PONTO_A["latitude"], "ruim")
    feicoes = _arvores(cliente.como(revisor), 12, PONTO_A["longitude"], PONTO_A["latitude"])
    assert all("bairro" not in f["props"] for f in feicoes)
    assert sum(f["props"]["quantidade"] for f in feicoes) == 3


def test_o_grupo_respeita_o_escopo_e_os_filtros(cliente, revisor, tecnico_a, territorios):
    _arvore(PONTO_A["longitude"], PONTO_A["latitude"], "ruim")
    _arvore(PONTO_A["longitude"], PONTO_A["latitude"], "boa")
    _arvore(PONTO_B["longitude"], PONTO_B["latitude"], "ruim")
    api = cliente.como(tecnico_a)
    # Escopo só do Bairro A: o Bairro B não aparece.
    assert {f["props"]["bairro"] for f in _arvores(api, 10, -38.55, -3.755)} == {"Bairro A"}
    # O filtro de condição vale para a contagem do grupo.
    (grupo,) = _arvores(api, 10, -38.55, -3.755, condicao_aparente="ruim")
    assert grupo["props"]["quantidade"] == 1
    # Quem tem o município inteiro vê os dois bairros.
    ambos = {f["props"]["bairro"] for f in _arvores(cliente.como(revisor), 10, -38.55, -3.755)}
    assert ambos == {"Bairro A", "Bairro B"}
