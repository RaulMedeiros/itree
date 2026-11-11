"""Visão geral (M-02): variação contra o período anterior, série mensal e pendências."""

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from itree.alertas.models import AlertaAmbiental
from itree.ocorrencias.models import Ocorrencia, TipoOcorrencia

from .conftest import PONTO_A, PONTO_B, com_escopo, criar_usuario

pytestmark = pytest.mark.django_db

URL = "/api/v1/indicadores/painel"


def ocorrencia(tipo, ponto, dias_atras=0, **extras):
    o = Ocorrencia.objects.create(
        tipo=tipo,
        geom=Point(ponto["longitude"], ponto["latitude"], srid=4326),
        descricao="Teste",
        origem="web",
        registrada_por=_autor(),
        **extras,
    )
    Ocorrencia.objects.filter(pk=o.pk).update(criado_em=timezone.now() - timedelta(days=dias_atras))
    return o


def _autor():
    from itree.contas.models import Usuario

    return Usuario.objects.filter(email="autor@itree.teste").first() or criar_usuario(
        "autor@itree.teste"
    )


@pytest.fixture
def tipo(db):
    return TipoOcorrencia.objects.create(nome="Galho caído")


def test_ocorrencias_registradas_com_periodo_anterior(cliente, gestor_municipal, tipo):
    ocorrencia(tipo, PONTO_A, 2)
    ocorrencia(tipo, PONTO_A, 5)
    ocorrencia(tipo, PONTO_A, 40)  # período anterior (31 a 61 dias atrás)
    ocorrencia(tipo, PONTO_A, 90)  # fora dos dois períodos
    corpo = cliente.como(gestor_municipal).get(URL).json()
    ind = {i["id"]: i for i in corpo["indicadores"]}
    assert (
        ind["ocorrencias_registradas"]["valor"],
        ind["ocorrencias_registradas"]["anterior"],
    ) == (2, 1)
    # Indicadores instantâneos não têm período anterior.
    assert ind["arvores_validas"]["anterior"] is None
    assert ind["inspecoes_realizadas"]["anterior"] == 0


def test_serie_mensal_tem_12_meses_terminando_no_fim_do_periodo(cliente, gestor_municipal, tipo):
    hoje = timezone.localdate()
    ocorrencia(tipo, PONTO_A, 0)
    ocorrencia(tipo, PONTO_A, 0)
    corpo = cliente.como(gestor_municipal).get(URL).json()
    serie = corpo["series_mensais"]
    assert len(serie["meses"]) == 12 and serie["meses"][-1] == f"{hoje:%Y-%m}"
    ano, mes = (hoje.year, 1) if hoje.month == 12 else (hoje.year - 1, hoje.month + 1)
    assert serie["meses"][0] == f"{ano:04d}-{mes:02d}"
    valores = {s["id"]: s["valores"] for s in serie["series"]}
    assert valores["ocorrencias"][-1] == 2 and sum(valores["ocorrencias"]) == 2
    assert len(valores["inspecoes"]) == 12


def test_pendencias_so_com_quantidade_e_no_escopo(cliente, tipo, territorios):
    so_a = com_escopo(criar_usuario("ga@itree.teste", ["gestor"]), territorios["a"])
    ontem = timezone.localdate() - timedelta(days=1)
    ocorrencia(tipo, PONTO_A, prazo=ontem, risco_confirmado=True, prioridade="alta")
    ocorrencia(tipo, PONTO_B, prazo=ontem)  # fora do escopo de so_a
    pendencias = {p["id"]: p for p in cliente.como(so_a).get(URL).json()["pendencias"]}
    assert pendencias["risco_confirmado"]["quantidade"] == 1
    assert pendencias["ocorrencias_atrasadas"]["quantidade"] == 1
    assert pendencias["ocorrencias_atrasadas"]["link"]["filtros"] == {"atrasadas": "true"}
    assert "tarefas_atrasadas" not in pendencias  # zero não aparece
    assert "sem_prioridade" not in pendencias


def test_pendencia_de_alertas_exige_permissao(cliente, gestor_municipal, territorios):
    AlertaAmbiental.objects.create(
        tipo="foco_calor",
        fonte="inpe_focos",
        id_externo="X1",
        geom=Point(PONTO_A["longitude"], PONTO_A["latitude"], srid=4326),
        data_deteccao=timezone.now(),
    )
    sem_alertas = {p["id"] for p in cliente.como(gestor_municipal).get(URL).json()["pendencias"]}
    analista = com_escopo(
        criar_usuario("an@itree.teste", ["analista_ambiental"]), territorios["municipio"]
    )
    com_alertas = {p["id"]: p for p in cliente.como(analista).get(URL).json()["pendencias"]}
    assert ("alertas_detectados" in sem_alertas) is gestor_municipal.tem_permissao("alertas.ler")
    assert com_alertas["alertas_detectados"]["quantidade"] == 1


def test_analise_traz_evolucao_mensal_com_zeros(cliente, gestor_municipal, tipo):
    ocorrencia(tipo, PONTO_A, 2)
    ocorrencia(tipo, PONTO_A, 5)
    ocorrencia(tipo, PONTO_A, 70)
    corpo = (
        cliente.como(gestor_municipal)
        .get("/api/v1/relatorios/analise", {"analise": "ocorrencias_por_tipo"})
        .json()
    )
    serie = corpo["serie_mensal"]
    assert len(serie["meses"]) == 13  # 12 meses corridos + o mês corrente
    registradas = next(s for s in serie["series"] if s["id"] == "registradas")
    assert len(registradas["valores"]) == len(serie["meses"])
    assert sum(registradas["valores"]) == 3
    assert 0 in registradas["valores"]  # meses sem registro entram com zero


def test_analise_sem_dimensao_temporal_nao_tem_serie_mensal(cliente, gestor_municipal):
    corpo = (
        cliente.como(gestor_municipal)
        .get("/api/v1/relatorios/analise", {"analise": "arvores_por_bairro"})
        .json()
    )
    assert corpo["serie_mensal"] is None


# --- Bairros que pedem atenção (G-02) -------------------------------------------


def arvore_em(ponto, condicao="", inspecionada_ha_dias=None):
    from itree.inventario.models import Arvore

    a = Arvore.objects.create(
        origem_registro="importacao",
        localizacao_origem="importada",
        geom=Point(ponto["longitude"], ponto["latitude"], srid=4326),
        condicao_aparente=condicao,
    )
    if inspecionada_ha_dias is not None:
        Arvore.objects.filter(pk=a.pk).update(
            ultima_inspecao_em=timezone.now() - timedelta(days=inspecionada_ha_dias)
        )
    return a


def ranking(cliente, usuario, **params):
    return cliente.como(usuario).get(URL, params).json()["bairros_atencao"]


def test_bairros_atencao_ordena_pelo_indice_e_separa_os_componentes(
    cliente, gestor_municipal, tipo, territorios
):
    ontem = timezone.localdate() - timedelta(days=1)
    # Bairro A: uma ocorrência aberta com risco confirmado (10) e prazo vencido (5), mais
    # 2 árvores ruins ou mortas (2 cada). A árvore boa e inspecionada há pouco não pesa.
    ocorrencia(tipo, PONTO_A, prazo=ontem, risco_confirmado=True)
    arvore_em(PONTO_A, "ruim", 10)
    arvore_em(PONTO_A, "morta", 10)
    arvore_em(PONTO_A, "boa", 10)
    # Bairro B: só 3 árvores sem inspeção (3).
    for _ in range(3):
        arvore_em(PONTO_B, "boa", 400)

    r = ranking(cliente, gestor_municipal)
    assert [i["nome"] for i in r["itens"]] == ["Bairro A", "Bairro B"]
    a, b = r["itens"]
    por_id = {c["id"]: c["quantidade"] for c in a["componentes"]}
    assert por_id == {
        "risco_confirmado": 1,
        "atrasadas": 1,
        "ruins_ou_mortas": 2,
        "sem_inspecao": 0,
    }
    assert a["indice"] == 10 * 1 + 5 * 1 + 2 * 2 + 0
    assert b["indice"] == 3  # nunca inspecionada ou inspecionada há mais de 12 meses
    assert a["link"] == {"pagina": "/mapa", "filtros": {"destaque": str(a["id"])}}
    assert "risco confirmado" in r["definicao"]


def test_bairros_atencao_ignora_concluidas_e_bairros_sem_indice(
    cliente, gestor_municipal, tipo, territorios
):
    ontem = timezone.localdate() - timedelta(days=1)
    o = ocorrencia(tipo, PONTO_A, prazo=ontem, risco_confirmado=True)
    Ocorrencia.objects.filter(pk=o.pk).update(estado="concluida")
    arvore_em(PONTO_B, "boa", 10)  # inspecionada há pouco: não pesa
    assert ranking(cliente, gestor_municipal)["itens"] == []


def test_bairros_atencao_limita_a_5_bairros(cliente, gestor_municipal, territorios):
    from .conftest import criar_territorio, quadrado

    for n in range(6):
        t = criar_territorio(f"Extra {n}", geom=quadrado(-38.50 + n * 0.02, -3.70, 0.01))
        arvore_em({"longitude": t.geom.centroid.x, "latitude": t.geom.centroid.y}, "ruim", 5)
    arvore_em(PONTO_A, "ruim", 5)
    itens = ranking(cliente, gestor_municipal)["itens"]
    assert len(itens) == 5


def test_bairros_atencao_respeita_o_escopo(cliente, tipo, territorios):
    so_a = com_escopo(criar_usuario("sa@itree.teste", ["gestor"]), territorios["a"])
    arvore_em(PONTO_A, "ruim", 5)
    for _ in range(4):
        arvore_em(PONTO_B, "morta", 5)  # fora do escopo de so_a
    itens = ranking(cliente, so_a)["itens"]
    assert [i["nome"] for i in itens] == ["Bairro A"]


def test_bairros_atencao_nao_muda_com_o_filtro_de_bairro(cliente, gestor_municipal, territorios):
    arvore_em(PONTO_A, "ruim", 5)
    arvore_em(PONTO_B, "ruim", 5)
    filtrado = ranking(cliente, gestor_municipal, bairro=str(territorios["a"].pk))
    assert {i["nome"] for i in filtrado["itens"]} == {"Bairro A", "Bairro B"}
