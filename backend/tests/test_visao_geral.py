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
