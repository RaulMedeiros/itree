"""Instantâneos da visão geral (M-11): registro diário, série e valor anterior."""

from datetime import date, timedelta
from io import StringIO

import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.utils import timezone

from itree.indicadores import instantaneos
from itree.indicadores.models import RegistroIndicador
from itree.inventario.models import Arvore

from .conftest import PONTO_A, PONTO_B

pytestmark = pytest.mark.django_db

URL = "/api/v1/indicadores/painel"


def arvore(ponto):
    return Arvore.objects.create(
        origem_registro="importacao",
        localizacao_origem="importada",
        geom=Point(ponto["longitude"], ponto["latitude"], srid=4326),
    )


def registrar(territorio, dia, indicador, numerador, denominador=None):
    return RegistroIndicador.objects.create(
        data=dia,
        territorio=territorio,
        indicador=indicador,
        numerador=numerador,
        denominador=denominador,
    )


def indicadores(cliente, usuario, **params):
    corpo = cliente.como(usuario).get(URL, params).json()
    return {i["id"]: i for i in corpo["indicadores"]}


def test_comando_registra_por_territorio_e_e_idempotente(territorios):
    arvore(PONTO_A)
    arvore(PONTO_A)
    arvore(PONTO_B)
    Arvore.objects.create(origem_registro="importacao")  # sem localização: só no município
    dia = "2026-03-10"
    saida = StringIO()
    call_command("registrar_indicadores", "--data", dia, stdout=saida)
    call_command("registrar_indicadores", "--data", dia, stdout=saida)

    # 3 territórios × 10 instantâneos, sem duplicar na segunda execução.
    assert RegistroIndicador.objects.count() == 30
    r = {
        (x.territorio.nome, x.indicador): (x.numerador, x.denominador)
        for x in RegistroIndicador.objects.filter(data=date(2026, 3, 10))
    }
    assert r[("Bairro A", "arvores_registros")] == (2, None)
    assert r[("Bairro B", "arvores_registros")] == (1, None)
    assert r[("Município", "arvores_registros")] == (4, None)
    assert r[("Município", "arvores_validas")] == (3, None)
    assert r[("Bairro A", "especie_confirmada")] == (0, 2)


def test_comando_rejeita_data_invalida(db):
    from django.core.management import CommandError

    with pytest.raises(CommandError):
        call_command("registrar_indicadores", "--data", "10/03/2026")


def test_sem_registros_serie_vazia_e_anterior_nulo(cliente, gestor_municipal):
    ind = indicadores(cliente, gestor_municipal)
    assert ind["arvores_validas"]["serie"] == []
    assert ind["arvores_validas"]["anterior"] is None
    assert ind["arvores_validas"]["anterior_em"] is None
    assert ind["inspecoes_realizadas"]["serie"] == []


def test_escopo_de_bairro_ve_so_o_bairro(cliente, territorios, tecnico_a):
    hoje = timezone.localdate()
    mes_passado = hoje - timedelta(days=45)
    for t, n in [(territorios["a"], 4), (territorios["b"], 100), (territorios["municipio"], 110)]:
        registrar(t, mes_passado, "arvores_validas", n)
    ind = indicadores(cliente, tecnico_a)["arvores_validas"]
    assert ind["serie"] == [{"data": str(mes_passado), "valor": 4}]


def test_escopo_municipal_usa_o_municipio_sem_somar_bairros(cliente, territorios, gestor_municipal):
    dia = timezone.localdate() - timedelta(days=45)
    for t, n in [(territorios["a"], 4), (territorios["b"], 6), (territorios["municipio"], 11)]:
        registrar(t, dia, "arvores_validas", n)
    serie = indicadores(cliente, gestor_municipal)["arvores_validas"]["serie"]
    assert [p["valor"] for p in serie] == [11]


def test_escopo_com_dois_bairros_soma_numerador_e_denominador(cliente, territorios, tecnico_a):
    from .conftest import com_escopo

    com_escopo(tecnico_a, territorios["b"])
    dia = timezone.localdate() - timedelta(days=45)
    registrar(territorios["a"], dia, "especie_confirmada", 1, 4)
    registrar(territorios["b"], dia, "especie_confirmada", 3, 4)
    serie = indicadores(cliente, tecnico_a)["especie_confirmada"]["serie"]
    assert [p["valor"] for p in serie] == [50.0]  # (1+3)/(4+4), não a média simples


def test_anterior_e_o_registro_mais_proximo_ate_o_inicio(cliente, territorios, gestor_municipal):
    hoje = timezone.localdate()
    inicio = hoje - timedelta(days=30)
    m = territorios["municipio"]
    registrar(m, inicio - timedelta(days=20), "arvores_validas", 5)
    registrar(m, inicio - timedelta(days=3), "arvores_validas", 8)  # o certo
    registrar(m, inicio + timedelta(days=2), "arvores_validas", 9)  # depois do início
    ind = indicadores(cliente, gestor_municipal)["arvores_validas"]
    assert ind["anterior"] == 8
    assert ind["anterior_em"] == str(inicio - timedelta(days=3))
    # Série: um ponto por mês (o último de cada mês), em ordem de data.
    datas = [p["data"] for p in ind["serie"]]
    assert datas == sorted(datas) and len(datas) <= 12


def test_serie_um_ponto_por_mes_com_no_maximo_12(territorios):
    m = territorios["municipio"]
    fim = date(2026, 6, 30)
    for i in range(0, 400, 5):
        registrar(m, fim - timedelta(days=i), "arvores_validas", i)
    h = instantaneos.historico([m], fim - timedelta(days=30), fim, set())["arvores_validas"]
    assert len(h["serie"]) == 12
    meses = [(p["data"].year, p["data"].month) for p in h["serie"]]
    assert len(set(meses)) == 12


def test_indicador_do_periodo_continua_sem_serie(cliente, gestor_municipal):
    ind = indicadores(cliente, gestor_municipal)["ocorrencias_registradas"]
    assert ind["serie"] == [] and ind["anterior"] == 0
    assert ind["anterior_em"] is not None


def test_filtro_de_equipe_nao_tem_historico(cliente, territorios, gestor_municipal):
    from itree.contas.models import Equipe

    e = Equipe.objects.create(nome="Eq", coordenador=gestor_municipal)
    registrar(
        territorios["municipio"], timezone.localdate() - timedelta(days=40), "arvores_validas", 3
    )
    ind = indicadores(cliente, gestor_municipal, equipe=str(e.pk))["arvores_validas"]
    assert ind["serie"] == [] and ind["anterior"] is None
