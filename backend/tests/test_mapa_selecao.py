"""Seleção por área no mapa (RF-MAPA-022): itens dentro do polígono, com escopo e filtros."""

import json

import pytest
from django.contrib.gis.geos import Point

from itree.inventario.models import Arvore
from itree.mapa import selecao as mapa_selecao
from itree.ocorrencias.models import Ocorrencia
from itree.relatorios.models import Exportacao

from .conftest import PONTO_A, PONTO_B

pytestmark = pytest.mark.django_db

URL = "/api/v1/mapa/selecao"
URL_EXPORTAR = "/api/v1/mapa/selecao/exportar"
FORA = {"longitude": -38.45, "latitude": -3.70}  # no município, fora da área desenhada


def poligono(oeste=-38.57, sul=-3.77, leste=-38.52, norte=-3.74) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [[[oeste, sul], [leste, sul], [leste, norte], [oeste, norte], [oeste, sul]]],
    }


def _arvore(ponto, condicao=""):
    return Arvore.objects.create(
        geom=Point(ponto["longitude"], ponto["latitude"], srid=4326), condicao_aparente=condicao
    )


def _ocorrencia(ponto, tipo, usuario, estado="aberta"):
    return Ocorrencia.objects.create(
        tipo=tipo,
        geom=Point(ponto["longitude"], ponto["latitude"], srid=4326),
        descricao="Galho",
        origem="web",
        registrada_por=usuario,
        estado=estado,
    )


@pytest.fixture
def cenario(gestor_municipal, tipo_queda):
    """Três árvores dentro da área (A: boa e ruim; B: ruim), uma fora e ocorrências."""
    dentro = [_arvore(PONTO_A, "boa"), _arvore(PONTO_A, "ruim"), _arvore(PONTO_B, "ruim")]
    fora = _arvore(FORA, "ruim")
    ocorrencias = [
        _ocorrencia(PONTO_A, tipo_queda, gestor_municipal),
        _ocorrencia(PONTO_B, tipo_queda, gestor_municipal),
        _ocorrencia(PONTO_B, tipo_queda, gestor_municipal, estado="concluida"),
        _ocorrencia(FORA, tipo_queda, gestor_municipal),
    ]
    return {"dentro": dentro, "fora": fora, "ocorrencias": ocorrencias}


def _selecionar(cliente, usuario, **corpo):
    return cliente.como(usuario).post(URL, {"geometria": poligono(), **corpo}, format="json")


def test_devolve_so_o_que_esta_dentro_da_area(cliente, gestor_municipal, cenario):
    r = _selecionar(cliente, gestor_municipal)
    assert r.status_code == 200
    corpo = r.json()
    assert corpo["arvores"]["total"] == 3
    assert corpo["arvores"]["por_condicao"] == {"boa": 1, "ruim": 2}
    assert [i["codigo"] for i in corpo["arvores"]["itens"]] == [a.codigo for a in cenario["dentro"]]
    assert str(cenario["fora"].id) not in {i["id"] for i in corpo["arvores"]["itens"]}
    # Só as abertas, por padrão, como no mapa.
    assert corpo["ocorrencias"]["total"] == 2
    assert {i["codigo"] for i in corpo["ocorrencias"]["itens"]} == {
        o.codigo for o in cenario["ocorrencias"][:2]
    }
    assert corpo["arvores"]["truncado"] is False
    assert corpo["limite_itens"] == 2000 and corpo["limite_tarefas_em_lote"] == 1000
    assert 0 < corpo["area_km2"] < 100


def test_arvore_sem_condicao_vira_nao_avaliada(cliente, gestor_municipal):
    _arvore(PONTO_A)
    corpo = _selecionar(cliente, gestor_municipal).json()
    assert corpo["arvores"]["por_condicao"] == {"nao_avaliada": 1}
    assert corpo["arvores"]["itens"][0]["condicao"] == "nao_avaliada"


def test_respeita_o_escopo_territorial(cliente, tecnico_a, gestor_municipal, cenario):
    # A área cobre os bairros A e B, mas o técnico só tem escopo no A.
    corpo = _selecionar(cliente, tecnico_a).json()
    codigos = {i["codigo"] for i in corpo["arvores"]["itens"]}
    assert codigos == {a.codigo for a in cenario["dentro"][:2]}
    assert corpo["arvores"]["total"] == 2
    assert corpo["ocorrencias"]["total"] == 1
    assert corpo["ocorrencias"]["itens"][0]["codigo"] == cenario["ocorrencias"][0].codigo


def test_usuario_sem_escopo_nao_ve_nada(cliente, cenario):
    from .conftest import criar_usuario

    sem_escopo = criar_usuario("sem@itree.teste", ["gestor"])
    corpo = _selecionar(cliente, sem_escopo).json()
    assert corpo["arvores"] == {"total": 0, "por_condicao": {}, "itens": [], "truncado": False}
    assert corpo["ocorrencias"]["total"] == 0


def test_aplica_os_filtros_do_mapa(cliente, gestor_municipal, cenario):
    corpo = _selecionar(
        cliente,
        gestor_municipal,
        filtros={"condicao_aparente": "boa", "estado": "todas"},
    ).json()
    assert corpo["arvores"]["total"] == 1
    assert corpo["arvores"]["itens"][0]["codigo"] == cenario["dentro"][0].codigo
    assert corpo["ocorrencias"]["total"] == 3  # "todas" inclui a concluída
    sem = _selecionar(cliente, gestor_municipal, filtros={"condicao_aparente": "sem"}).json()
    assert sem["arvores"]["total"] == 0


def test_so_as_camadas_pedidas(cliente, gestor_municipal, cenario):
    corpo = _selecionar(cliente, gestor_municipal, camadas=["ocorrencias"]).json()
    assert corpo["arvores"] is None and corpo["ocorrencias"]["total"] == 2


def test_limite_de_itens_avisa_que_truncou(cliente, gestor_municipal, cenario, monkeypatch):
    monkeypatch.setattr(mapa_selecao, "LIMITE_ITENS", 2)
    corpo = _selecionar(cliente, gestor_municipal).json()
    assert corpo["arvores"]["truncado"] is True
    assert corpo["arvores"]["total"] == 3 and len(corpo["arvores"]["itens"]) == 2
    # O resumo cobre a seleção inteira, não só os itens listados.
    assert corpo["arvores"]["por_condicao"] == {"boa": 1, "ruim": 2}
    assert corpo["limite_itens"] == 2
    assert corpo["ocorrencias"]["truncado"] is False


@pytest.mark.parametrize(
    "geometria",
    [
        # Laço: arestas que se cruzam.
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]},
        {"type": "Point", "coordinates": [-38.5, -3.7]},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 0]]]},
        {"type": "Polygon", "coordinates": "x"},
        {"type": "Polygon", "coordinates": [[[-200, 0], [-199, 0], [-199, 1], [-200, 0]]]},
        "isto não é GeoJSON",
        None,
    ],
)
def test_geometria_invalida_responde_400(cliente, gestor_municipal, geometria):
    r = cliente.como(gestor_municipal).post(URL, {"geometria": geometria}, format="json")
    assert r.status_code == 400
    assert "geometria" in r.json()


def test_area_grande_demais_responde_400(cliente, gestor_municipal):
    r = cliente.como(gestor_municipal).post(
        URL, {"geometria": poligono(-39.5, -4.5, -38.5, -3.5)}, format="json"
    )
    assert r.status_code == 400
    assert "máximo" in r.json()["geometria"][0]


def test_filtro_invalido_responde_400_e_exige_autenticacao(cliente, gestor_municipal):
    r = _selecionar(cliente, gestor_municipal, filtros={"especie": "nao-e-uuid"})
    assert r.status_code == 400
    cliente.credentials()  # sem token
    assert cliente.post(URL, {"geometria": poligono()}, format="json").status_code in (401, 403)


def test_sem_permissao_de_nenhuma_camada_responde_403(cliente, cenario, territorios):
    from .conftest import com_escopo, criar_usuario

    # Papel sem permissões de mapa nem de ocorrências.
    sem_permissao = com_escopo(criar_usuario("nada@itree.teste", ["inexistente"]), territorios["a"])
    assert _selecionar(cliente, sem_permissao).status_code == 403


# --- Exportação da seleção -----------------------------------------------------


def _exportar(cliente, usuario, **corpo):
    return cliente.como(usuario).post(
        URL_EXPORTAR, {"geometria": poligono(), **corpo}, format="json"
    )


def test_exporta_csv_da_selecao_com_proveniencia(cliente, gestor_municipal, cenario):
    r = _exportar(cliente, gestor_municipal, conjunto="arvores", formato="csv")
    assert r.status_code == 200 and "attachment" in r["Content-Disposition"]
    texto = r.content.decode("utf-8-sig")
    meta = [linha for linha in texto.splitlines() if linha.startswith("#")]
    assert any("Seleção por área" in m for m in meta)
    assert any(m.startswith("# filtros:") and "geometria" in m for m in meta)
    assert any("gerado_por" in m for m in meta)
    dados = [linha for linha in texto.splitlines() if not linha.startswith("#")]
    assert len(dados) - 1 == 3
    assert cenario["fora"].codigo not in texto
    registro = Exportacao.objects.get()
    assert registro.linhas == 3 and registro.filtros["selecao"] == "area"


def test_exporta_geojson_de_ocorrencias_com_filtros(cliente, gestor_municipal, cenario):
    r = _exportar(
        cliente,
        gestor_municipal,
        conjunto="ocorrencias",
        formato="geojson",
        filtros={"estado": "todas"},
    )
    corpo = json.loads(r.content)
    assert len(corpo["features"]) == 3
    assert corpo["metadata"]["registros"] == 3
    assert corpo["metadata"]["filtros"]["estado"] == "todas"


def test_exportacao_respeita_permissao_e_escopo(cliente, tecnico_a, gestor_municipal, cenario):
    # O técnico não tem "relatorios.exportar".
    assert _exportar(cliente, tecnico_a, conjunto="arvores", formato="csv").status_code == 403
    assert (
        _exportar(cliente, gestor_municipal, conjunto="alertas", formato="csv").status_code == 400
    )
    assert (
        _exportar(cliente, gestor_municipal, conjunto="arvores", formato="pdf").status_code == 400
    )
    assert not Exportacao.objects.exists()


def test_exportacao_fora_do_escopo_do_exportador(cliente, territorios, cenario):
    from .conftest import com_escopo, criar_usuario

    # Coordenação só com escopo no bairro A: não leva as árvores do B.
    coordenador = com_escopo(criar_usuario("coord@itree.teste", ["coordenador"]), territorios["a"])
    r = _exportar(cliente, coordenador, conjunto="arvores", formato="geojson")
    assert len(json.loads(r.content)["features"]) == 2
