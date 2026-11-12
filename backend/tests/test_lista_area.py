"""M-24: a lista de árvores aceita `area`, no formato compacto da URL do mapa."""

import pytest
from django.contrib.gis.geos import Point

from itree.core.geo import decodificar_area
from itree.inventario.models import Arvore

from .conftest import PONTO_A, PONTO_B

pytestmark = pytest.mark.django_db

URL = "/api/v1/arvores"
FORA = {"longitude": -38.45, "latitude": -3.70}  # no município, fora da área


def codificar(vertices: list[tuple[float, float]]) -> str:
    """Mesmo formato de `codificarArea` (apps/web/src/mapa/areaUrl.ts), sem o vértice final."""
    anterior = [0, 0]
    partes = []
    for longitude, latitude in vertices:
        atual = [round(longitude * 1_000_000), round(latitude * 1_000_000)]
        for valor, antes in zip(atual, anterior, strict=True):
            partes.append(_base36(valor - antes))
        anterior = atual
    return "_".join(partes)


def _base36(n: int) -> str:
    if n == 0:
        return "0"
    digitos, resto = "0123456789abcdefghijklmnopqrstuvwxyz", abs(n)
    texto = ""
    while resto:
        resto, d = divmod(resto, 36)
        texto = digitos[d] + texto
    return ("-" if n < 0 else "") + texto


# Retângulo que cobre o bairro A (-38.56..-38.55) e o B (-38.54..-38.53), nada além.
AREA = codificar([(-38.57, -3.77), (-38.52, -3.77), (-38.52, -3.74), (-38.57, -3.74)])


def _arvore(ponto, **extras):
    return Arvore.objects.create(
        geom=Point(ponto["longitude"], ponto["latitude"], srid=4326), **extras
    )


def _codigos(cliente, **params):
    r = cliente.get(URL, params)
    assert r.status_code == 200, r.json()
    return {a["codigo"] for a in r.json()["results"]}


def test_codificador_dos_testes_coincide_com_o_da_interface():
    # Vetor gerado por `codificarArea` da interface para o mesmo retângulo.
    assert AREA == "-myosw_-28sy8_12kw_0_0_n5c_-12kw_0"


def test_decodifica_o_formato_compacto_do_mapa():
    poligono = decodificar_area(AREA)
    assert poligono.srid == 4326
    assert poligono.extent == pytest.approx((-38.57, -3.77, -38.52, -3.74))


def test_a_lista_filtra_pelo_poligono(cliente, gestor_municipal):
    dentro = [_arvore(PONTO_A), _arvore(PONTO_B)]
    fora = _arvore(FORA)
    cliente.como(gestor_municipal)
    assert _codigos(cliente, area=AREA) == {a.codigo for a in dentro}
    assert fora.codigo in _codigos(cliente)
    # O contador da lista usa o mesmo filtro.
    assert cliente.get(URL, {"area": AREA}).json()["count"] == 2


def test_area_combina_com_os_outros_filtros_da_lista(cliente, gestor_municipal):
    ruim = _arvore(PONTO_A, condicao_aparente="ruim")
    _arvore(PONTO_B, condicao_aparente="boa")
    _arvore(FORA, condicao_aparente="ruim")
    cliente.como(gestor_municipal)
    assert _codigos(cliente, area=AREA, condicao_aparente="ruim") == {ruim.codigo}


def test_lista_e_selecao_do_mapa_alcancam_as_mesmas_arvores(cliente, gestor_municipal):
    for p in (PONTO_A, PONTO_B, FORA):
        _arvore(p)
    cliente.como(gestor_municipal)
    selecao = cliente.post(
        "/api/v1/mapa/selecao",
        {"geometria": {"type": "Polygon", "coordinates": [_anel(AREA)]}, "camadas": ["arvores"]},
        format="json",
    ).json()["arvores"]
    assert selecao["total"] == cliente.get(URL, {"area": AREA}).json()["count"] == 2
    assert {i["codigo"] for i in selecao["itens"]} == _codigos(cliente, area=AREA)


def _anel(area: str) -> list[list[float]]:
    anel = [list(c) for c in decodificar_area(area).exterior_ring.coords]
    return anel


def test_area_respeita_o_escopo_territorial(cliente, tecnico_a):
    dentro = _arvore(PONTO_A)
    _arvore(PONTO_B)  # fora do escopo do técnico (bairro A)
    assert _codigos(cliente.como(tecnico_a), area=AREA) == {dentro.codigo}


@pytest.mark.parametrize(
    "texto",
    [
        "abc",  # poucos vértices e número ímpar de partes
        "0_0_1_0_0_1_x!_0",  # caractere fora do formato
        "0_0_1_0_1",  # número ímpar de partes
        "zzzzzzzz_0_1_0_0_1",  # longitude fora do intervalo
        # Gravata: as arestas se cruzam e o polígono é inválido.
        codificar([(-38.57, -3.77), (-38.52, -3.74), (-38.52, -3.77), (-38.57, -3.74)]),
    ],
)
def test_area_malformada_e_recusada_com_mensagem(cliente, gestor_municipal, texto):
    r = cliente.como(gestor_municipal).get(URL, {"area": texto})
    assert r.status_code == 400
    assert "area" in r.json()


def test_area_com_vertices_demais_e_recusada(cliente, gestor_municipal):
    muitos = "_".join(["1", "1"] * 201)
    r = cliente.como(gestor_municipal).get(URL, {"area": muitos})
    assert r.status_code == 400
