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


def _grupo_em_zoom_baixo(cliente, condicoes):
    """Cria uma árvore por condição na mesma célula e devolve o conteúdo do tile agrupado."""
    for c in condicoes:
        a = Arvore.objects.create(
            geom=Point(PONTO_A["longitude"], PONTO_A["latitude"], srid=4326),
            condicao_aparente=c,
        )
        assert a.pk
    x, y = _tile(PONTO_A["longitude"], PONTO_A["latitude"], 10)
    return cliente.get(f"/api/v1/mapa/tiles/arvores/10/{x}/{y}").content


def test_grupo_de_arvores_traz_a_pior_condicao(cliente, revisor):
    cliente.como(revisor)
    # Os valores de condição só aparecem no tile via `pior_condicao` (grupo não leva `condicao`).
    conteudo = _grupo_em_zoom_baixo(cliente, ["boa", "ruim", "morta"])
    assert b"pior_condicao" in conteudo and b"morta" in conteudo
    assert b"ruim" not in conteudo and b"boa" not in conteudo


def test_grupo_sem_morta_indica_ruim(cliente, revisor):
    conteudo = _grupo_em_zoom_baixo(cliente.como(revisor), ["boa", "regular", "ruim"])
    assert b"ruim" in conteudo and b"morta" not in conteudo and b"regular" not in conteudo


def test_grupo_so_de_nao_avaliadas(cliente, revisor):
    conteudo = _grupo_em_zoom_baixo(cliente.como(revisor), ["", ""])
    assert b"pior_condicao" in conteudo and b"nao_avaliada" in conteudo


def test_celula_de_agrupamento_maior_que_o_icone_em_todo_zoom_agrupado():
    """Os grupos não podem se sobrepor na tela: a célula tem de passar do maior ícone (R2-07)."""
    from itree.mapa.views import CIRCUNFERENCIA_3857, TILE_PX, ZOOM_INDIVIDUAL, tamanho_da_celula

    maior_icone_px = 46  # `aoFaltarImagem`, em simbologia.ts, para 1.000 ou mais
    for z in range(0, ZOOM_INDIVIDUAL):
        px = tamanho_da_celula(z) / (CIRCUNFERENCIA_3857 / 2**z) * TILE_PX
        assert px > maior_icone_px, f"zoom {z}: célula de {px:.0f} px"


def test_celula_de_agrupamento_e_maior_no_zoom_de_municipio():
    """Em zoom de município a célula é mais grossa, em pixels de tela, que nos zooms seguintes."""
    from itree.mapa.views import CIRCUNFERENCIA_3857, TILE_PX, tamanho_da_celula

    def px(z: int) -> float:
        return tamanho_da_celula(z) / (CIRCUNFERENCIA_3857 / 2**z) * TILE_PX

    assert px(10) == pytest.approx(px(11))
    assert px(11) > px(12)
    assert px(12) == pytest.approx(px(15))
