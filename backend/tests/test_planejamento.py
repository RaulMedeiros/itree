"""Critérios do cenário "Onde plantar": percentis na direção certa, bairro sem dado, ilha de calor
ausente ou presente, área verde recortada pelo bairro, escopo e número de consultas."""

from datetime import date

import pytest
from django.contrib.gis.geos import MultiPolygon, Point, Polygon
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from itree.areas_verdes.models import AreaVerde
from itree.indicadores import ilha_calor, planejamento
from itree.indicadores import populacao as pop
from itree.indicadores.externos import ARBORIZACAO_FACES
from itree.indicadores.models import IndicadorTerritorialExterno
from itree.inventario.models import Arvore

from .conftest import com_escopo, criar_territorio, criar_usuario, quadrado

pytestmark = pytest.mark.django_db

URL = "/api/v1/planejamento/criterios"


def indicador(bairro, nome, valor, numerador=0, denominador=None, **extra):
    return IndicadorTerritorialExterno.objects.create(
        territorio=bairro,
        indicador=nome,
        valor=valor,
        numerador=numerador,
        denominador=denominador,
        fonte="Fonte de teste",
        data_referencia=date(2022, 7, 31),
        ingerido_em=timezone.now(),
        definicao="d",
        metodo="m",
        **extra,
    )


def semear(bairro, *, pessoas, densidade, renda, arborizacao):
    indicador(bairro, pop.POPULACAO_CENSO, pessoas, numerador=pessoas, denominador=10)
    indicador(bairro, pop.DENSIDADE, densidade, numerador=pessoas, denominador=1_000_000)
    indicador(bairro, pop.RENDA, renda, numerador=1, denominador=1)
    indicador(bairro, ARBORIZACAO_FACES, arborizacao, numerador=1, denominador=2)


def arvores(ponto, n):
    for _ in range(n):
        Arvore.objects.create(
            origem_registro="importacao",
            localizacao_origem="importada",
            geom=Point(ponto[0], ponto[1], srid=4326),
        )


@pytest.fixture
def cidade(db):
    """Quatro bairros lado a lado (A a D) e o município. A é o que mais pede plantio em tudo,
    D é o que menos pede; B e C ficam no meio. E não tem nenhum dado."""
    municipio = criar_territorio("Município", tipo="municipio", geom=quadrado(-38.60, -3.80, 0.2))
    nomes = ["A", "B", "C", "D", "E"]
    b = {
        n: criar_territorio(f"Bairro {n}", geom=quadrado(-38.56 + 0.02 * i, -3.76, 0.01))
        for i, n in enumerate(nomes)
    }
    #                pessoas densidade renda arborização
    semear(b["A"], pessoas=10_000, densidade=9000, renda=1000, arborizacao=30)
    semear(b["B"], pessoas=10_000, densidade=6000, renda=2000, arborizacao=45)
    semear(b["C"], pessoas=10_000, densidade=3000, renda=4000, arborizacao=60)
    semear(b["D"], pessoas=10_000, densidade=1000, renda=8000, arborizacao=80)
    for n, qtd in {"A": 1, "B": 10, "C": 50, "D": 200}.items():
        arvores(
            (-38.56 + 0.02 * nomes.index(n) + 0.005, -3.755),
            qtd,
        )
    return {"municipio": municipio, **b}


@pytest.fixture
def gestor_municipal(cidade):
    return com_escopo(criar_usuario("gm@itree.teste", ["gestor"]), cidade["municipio"])


def consultar(cliente, usuario):
    r = cliente.como(usuario).get(URL)
    assert r.status_code == 200, r.content
    return r.json()


def por_nome(corpo):
    return {b["nome"]: b for b in corpo["bairros"]}


def criterio(corpo, id_):
    return next(c for c in corpo["criterios"] if c["id"] == id_)


# --- Percentil --------------------------------------------------------------------------------


def test_percentil_na_direcao_certa():
    valores = {"x": 10.0, "y": 20.0, "z": 30.0}
    assert planejamento.percentis(valores, planejamento.ALTO) == {"x": 0.0, "y": 0.5, "z": 1.0}
    assert planejamento.percentis(valores, planejamento.BAIXO) == {"x": 1.0, "y": 0.5, "z": 0.0}


def test_percentil_empate_divide_a_posicao_e_sem_valor_fica_nulo():
    r = planejamento.percentis({"a": 1.0, "b": 1.0, "c": 5.0, "d": None}, planejamento.ALTO)
    assert r == {"a": 0.25, "b": 0.25, "c": 1.0, "d": None}


def test_percentil_de_um_so_bairro_e_meio():
    assert planejamento.percentis({"a": 3.0, "b": None}, planejamento.BAIXO) == {
        "a": 0.5,
        "b": None,
    }


# --- Endpoint: direção, bairro sem dado ---------------------------------------------------------


def test_cada_criterio_usa_a_direcao_certa(cliente, gestor_municipal, cidade):
    b = por_nome(consultar(cliente, gestor_municipal))
    # A: menos arborização, mais densidade, menos renda e menos árvores por 1.000 habitantes.
    for crit in ("arborizacao", "densidade", "renda", "arvores_por_mil"):
        assert b["Bairro A"]["percentis"][crit] == 1.0, crit
        assert b["Bairro D"]["percentis"][crit] == 0.0, crit
    assert b["Bairro B"]["percentis"]["densidade"] > b["Bairro C"]["percentis"]["densidade"]
    assert b["Bairro B"]["percentis"]["renda"] > b["Bairro C"]["percentis"]["renda"]
    assert b["Bairro A"]["valores"]["densidade"] == 9000
    assert b["Bairro A"]["valores"]["arvores_por_mil"] == 0.1
    assert b["Bairro D"]["valores"]["arvores_por_mil"] == 20.0


def test_bairro_sem_dado_fica_nulo_e_nao_entra_no_percentil(cliente, gestor_municipal, cidade):
    corpo = consultar(cliente, gestor_municipal)
    e = por_nome(corpo)["Bairro E"]
    assert all(v is None for v in e["valores"].values())
    assert all(v is None for v in e["percentis"].values())
    # Os quatro bairros com dado ocupam toda a faixa de 0 a 1.
    assert criterio(corpo, "densidade")["bairros_com_dado"] == 4
    assert (
        sorted(b["percentis"]["densidade"] for b in corpo["bairros"] if b["nome"] != "Bairro E")[-1]
        == 1.0
    )


def test_criterio_traz_fonte_ano_unidade_e_ressalva(cliente, gestor_municipal, cidade):
    corpo = consultar(cliente, gestor_municipal)
    arb = criterio(corpo, "arborizacao")
    assert arb["direcao"] == "baixo" and arb["ano"] == 2022 and arb["fonte"]
    assert criterio(corpo, "densidade")["direcao"] == "alto"
    por_mil = criterio(corpo, "arvores_por_mil")
    assert por_mil["provisorio"] and "inventário" in por_mil["ressalva"]
    assert por_mil["ano"] == 2022
    assert "DP-14" in corpo["aviso"]
    # O IDH 2010 não é critério.
    assert not any("idh" in c["id"] for c in corpo["criterios"])


# --- Ilha de calor ------------------------------------------------------------------------------


def test_ilha_de_calor_ausente_fica_indisponivel_com_explicacao(cliente, gestor_municipal, cidade):
    corpo = consultar(cliente, gestor_municipal)
    calor = criterio(corpo, "ilha_calor")
    assert calor["disponivel"] is False
    assert "UrbVerde" in calor["motivo_indisponivel"]
    assert all(b["valores"]["ilha_calor"] is None for b in corpo["bairros"])
    assert all(b["percentis"]["ilha_calor"] is None for b in corpo["bairros"])


def test_ilha_de_calor_presente_vira_criterio_com_valor_alto_prioritario(
    cliente, gestor_municipal, cidade
):
    indicador(cidade["A"], ilha_calor.INDICADOR, "3.2", numerador=10, denominador=10, unidade="°C")
    indicador(cidade["B"], ilha_calor.INDICADOR, "-1.5", numerador=10, denominador=10)
    corpo = consultar(cliente, gestor_municipal)
    calor = criterio(corpo, "ilha_calor")
    assert calor["disponivel"] is True and calor["motivo_indisponivel"] == ""
    assert calor["ano"] == ilha_calor.ANO and calor["bairros_com_dado"] == 2
    b = por_nome(corpo)
    assert b["Bairro A"]["valores"]["ilha_calor"] == 3.2
    assert b["Bairro A"]["percentis"]["ilha_calor"] == 1.0
    assert b["Bairro B"]["percentis"]["ilha_calor"] == 0.0
    assert b["Bairro C"]["percentis"]["ilha_calor"] is None


# --- Área verde por habitante -------------------------------------------------------------------


def _area_verde(geom, nome="Praça", tipo="praca"):
    return AreaVerde.objects.create(
        tipo=tipo,
        nome=nome,
        geom=MultiPolygon(Polygon.from_bbox(geom), srid=4326),
        fonte="Fortaleza em Mapas (teste)",
        data_referencia=date(2019, 1, 1),
        ingerido_em=timezone.now(),
    )


def test_sem_areas_verdes_importadas_o_criterio_fica_indisponivel(
    cliente, gestor_municipal, cidade
):
    corpo = consultar(cliente, gestor_municipal)
    verde = criterio(corpo, "area_verde")
    assert verde["disponivel"] is False
    assert all(b["valores"]["area_verde"] is None for b in corpo["bairros"])


def test_area_verde_e_recortada_pelo_bairro_e_nao_conta_sobreposicao_duas_vezes(
    cliente, gestor_municipal, cidade
):
    # Metade do Bairro A (0,005° x 0,01° ≈ 0,61 km²), a mesma metade de novo (sobreposta) e um
    # parque que cobre só um quarto do Bairro B e o espaço vazio entre os dois bairros.
    x0 = -38.56
    _area_verde((x0, -3.76, x0 + 0.005, -3.75), "Praça 1")
    _area_verde((x0, -3.76, x0 + 0.005, -3.75), "Praça 1 de novo")
    _area_verde((x0 + 0.015, -3.76, x0 + 0.0225, -3.75), "Parque", tipo="parque")
    corpo = consultar(cliente, gestor_municipal)
    b = por_nome(corpo)
    a_m2_hab = b["Bairro A"]["valores"]["area_verde"]
    # Sem contar a sobreposição: ≈ 0,61 km² para 10.000 pessoas, e não o dobro.
    assert 55 < a_m2_hab < 67
    # Só a parte do parque que fica dentro do bairro conta: um quarto de B, metade do que A tem (A tem metade do bairro).
    assert b["Bairro B"]["valores"]["area_verde"] == pytest.approx(a_m2_hab / 2, rel=0.05)
    # Bairro sem área verde dentro do limite tem 0 m²/hab (dado válido), e ordena por último.
    assert b["Bairro C"]["valores"]["area_verde"] == 0.0
    assert b["Bairro A"]["percentis"]["area_verde"] < b["Bairro C"]["percentis"]["area_verde"]
    assert criterio(corpo, "area_verde")["disponivel"] is True
    # Sem população do Censo, não há como dividir.
    assert b["Bairro E"]["valores"]["area_verde"] is None


# --- Escopo e permissão --------------------------------------------------------------------------


def test_escopo_limita_os_bairros_mas_nao_o_percentil(cliente, cidade):
    so_d = com_escopo(criar_usuario("d@itree.teste", ["gestor"]), cidade["D"])
    corpo = consultar(cliente, so_d)
    assert [b["nome"] for b in corpo["bairros"]] == ["Bairro D"]
    # O percentil é entre todos os bairros de Fortaleza: D continua sendo o de menor prioridade.
    assert corpo["bairros"][0]["percentis"]["densidade"] == 0.0
    assert criterio(corpo, "densidade")["bairros_com_dado"] == 4


def test_sem_permissao_de_relatorios_nao_acessa(cliente, cidade):
    tecnico = com_escopo(criar_usuario("t@itree.teste", ["tecnico"]), cidade["A"])
    assert cliente.como(tecnico).get(URL).status_code == 403


def test_exige_autenticacao(cliente):
    assert cliente.get(URL).status_code in (401, 403)


# --- Consultas ---------------------------------------------------------------------------------


def _consultas(cliente, usuario) -> int:
    with CaptureQueriesContext(connection) as ctx:
        consultar(cliente, usuario)
    return len(ctx)


def test_numero_de_consultas_nao_depende_do_numero_de_bairros(cliente, gestor_municipal, cidade):
    _area_verde((-38.56, -3.76, -38.555, -3.75))
    indicador(cidade["A"], ilha_calor.INDICADOR, 1, numerador=1, denominador=1)
    consultar(cliente, gestor_municipal)  # a primeira chamada cria o usuário e o cache
    antes = _consultas(cliente, gestor_municipal)
    for i in range(12):
        novo = criar_territorio(f"Extra {i}", geom=quadrado(-38.40 + 0.015 * i, -3.70, 0.01))
        semear(novo, pessoas=5000 + i, densidade=100 * i, renda=1500 + i, arborizacao=40 + i)
        arvores((-38.40 + 0.015 * i + 0.005, -3.695), 3)
        indicador(novo, ilha_calor.INDICADOR, i + 2, numerador=1, denominador=1)
        _area_verde((-38.40 + 0.015 * i, -3.70, -38.395 + 0.015 * i, -3.69), f"Praça {i}")
    depois = _consultas(cliente, gestor_municipal)
    assert depois == antes
    assert depois <= 25
