"""Linha do tempo do mapa: árvores, condição, ocorrências e alertas numa data (`ate`, `desde`).

As datas de cadastro e de conclusão são gravadas com `update`. A remoção de árvore e o cancelamento
de ocorrência saem do histórico (pghistory), cujo carimbo é o momento do teste: por isso "removida"
vale para o mês atual em diante e "ainda existia" para os meses anteriores.
"""

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from itree.alertas.models import AlertaAmbiental
from itree.inspecoes.models import Inspecao
from itree.inventario.models import Arvore
from itree.ocorrencias.models import Ocorrencia

from .conftest import PONTO_A, PONTO_B, criar_usuario
from .mvt_util import decodificar
from .test_evidencias_mapa import _tile

pytestmark = pytest.mark.django_db


def _atras(dias):
    return timezone.now() - timedelta(days=dias)


def _mes(dias):
    """Mês (AAAA-MM, hora local) de `dias` dias atrás."""
    d = timezone.localtime(_atras(dias))
    return f"{d.year:04d}-{d.month:02d}"


def _ponto(p):
    return Point(p["longitude"], p["latitude"], srid=4326)


def _arvore(ponto=PONTO_A, cadastrada_ha=100, condicao=""):
    a = Arvore.objects.create(geom=_ponto(ponto), condicao_aparente=condicao)
    Arvore.objects.filter(pk=a.pk).update(criado_em=_atras(cadastrada_ha))
    a.refresh_from_db()
    return a


def _ocorrencia(tipo, usuario, ponto=PONTO_A, registrada_ha=100, **extras):
    o = Ocorrencia.objects.create(
        tipo=tipo,
        geom=_ponto(ponto),
        descricao="Galho",
        origem="web",
        registrada_por=usuario,
        **extras,
    )
    Ocorrencia.objects.filter(pk=o.pk).update(criado_em=_atras(registrada_ha))
    return o


def _inspecao(arvore, tecnico, dias, condicao, estado="validada", aplicar=("condicao_aparente",)):
    return Inspecao.objects.create(
        arvore=arvore,
        tecnico=tecnico,
        realizada_em=_atras(dias),
        condicao_aparente=condicao,
        estado=estado,
        aplicado_ao_cadastro=list(aplicar),
    )


def _situacao(cliente, usuario, **params):
    r = cliente.como(usuario).get("/api/v1/mapa/situacao-na-data", params)
    assert r.status_code == 200, r.content
    return r.json()


def _tile_arvores(cliente, usuario, lon, lat, z=17, **params):
    x, y = _tile(lon, lat, z)
    r = cliente.como(usuario).get(f"/api/v1/mapa/tiles/arvores/{z}/{x}/{y}", params)
    assert r.status_code == 200
    return decodificar(r.content, z, x, y).get("arvores", [])


# --- árvores na data --------------------------------------------------------------------------


def test_arvore_cadastrada_depois_da_data_nao_aparece(cliente, revisor):
    _arvore(cadastrada_ha=100)
    assert _situacao(cliente, revisor, ate=_mes(200))["arvores"] == 0
    assert _situacao(cliente, revisor, ate=_mes(50))["arvores"] == 1


def test_arvore_removida_aparece_antes_da_remocao_e_some_depois(cliente, revisor):
    a = _arvore(cadastrada_ha=100)
    Arvore.objects.filter(pk=a.pk).update(situacao="excluida")  # remoção = agora, no histórico
    assert _situacao(cliente, revisor, ate=_mes(50))["arvores"] == 1
    assert _situacao(cliente, revisor, ate=_mes(0))["arvores"] == 0


def test_arvore_removida_nao_aparece_no_tile_do_mes_atual_mas_aparece_no_passado(cliente, revisor):
    a = _arvore(cadastrada_ha=100)
    Arvore.objects.filter(pk=a.pk).update(situacao="excluida")
    lon, lat = PONTO_A["longitude"], PONTO_A["latitude"]
    assert len(_tile_arvores(cliente, revisor, lon, lat, ate=_mes(50))) == 1
    assert _tile_arvores(cliente, revisor, lon, lat, ate=_mes(0)) == []
    # Sem `ate`, o mapa continua mostrando o presente: a árvore removida não está lá.
    assert _tile_arvores(cliente, revisor, lon, lat) == []


def test_sem_ate_o_tile_mostra_as_ativas_de_hoje_mesmo_cadastradas_agora(cliente, revisor):
    Arvore.objects.create(geom=_ponto(PONTO_A))
    lon, lat = PONTO_A["longitude"], PONTO_A["latitude"]
    assert len(_tile_arvores(cliente, revisor, lon, lat)) == 1
    assert _tile_arvores(cliente, revisor, lon, lat, ate=_mes(60)) == []


def test_intervalo_conta_so_as_cadastradas_no_periodo(cliente, revisor):
    _arvore(cadastrada_ha=200)
    _arvore(cadastrada_ha=100)
    assert _situacao(cliente, revisor, ate=_mes(50))["arvores"] == 2
    intervalo = _situacao(cliente, revisor, desde=_mes(110), ate=_mes(50))
    assert intervalo["arvores"] == 1


# --- condição na data -------------------------------------------------------------------------


def test_condicao_na_data_e_a_da_ultima_inspecao_validada_ate_ela(cliente, revisor, tecnico_a):
    a = _arvore(cadastrada_ha=200, condicao="morta")  # condição de hoje: a última aplicada
    _inspecao(a, tecnico_a, 120, "boa")
    _inspecao(a, tecnico_a, 40, "ruim")
    _inspecao(a, tecnico_a, 20, "morta", estado="em_revisao")  # não validada: não conta
    _inspecao(a, tecnico_a, 60, "regular", aplicar=())  # validada sem aplicar a condição: não conta
    lon, lat = PONTO_A["longitude"], PONTO_A["latitude"]

    def condicao(dias):
        (f,) = _tile_arvores(cliente, revisor, lon, lat, ate=_mes(dias))
        return f["props"]["condicao"]

    assert condicao(160) == "nao_avaliada"  # antes da primeira inspeção
    assert condicao(80) == "boa"
    assert condicao(30) == "ruim"


def test_filtro_de_condicao_vale_para_a_condicao_na_data(cliente, revisor, tecnico_a):
    a = _arvore(cadastrada_ha=200, condicao="ruim")
    _inspecao(a, tecnico_a, 120, "boa")
    _inspecao(a, tecnico_a, 40, "ruim")
    lon, lat = PONTO_A["longitude"], PONTO_A["latitude"]
    assert (
        len(_tile_arvores(cliente, revisor, lon, lat, ate=_mes(80), condicao_aparente="boa")) == 1
    )
    assert _tile_arvores(cliente, revisor, lon, lat, ate=_mes(80), condicao_aparente="ruim") == []


def test_grupo_de_bairro_na_data_conta_so_as_existentes_e_usa_a_condicao_da_data(
    cliente, revisor, tecnico_a, territorios
):
    velha = _arvore(cadastrada_ha=200, condicao="morta")
    _inspecao(velha, tecnico_a, 120, "boa")
    _arvore(cadastrada_ha=20)  # cadastrada depois da data
    x, y = _tile(PONTO_A["longitude"], PONTO_A["latitude"], 10)
    r = cliente.como(revisor).get(f"/api/v1/mapa/tiles/arvores/10/{x}/{y}", {"ate": _mes(80)})
    (grupo,) = [
        f
        for f in decodificar(r.content, 10, x, y)["arvores"]
        if f["props"].get("bairro") == "Bairro A"
    ]
    assert (grupo["props"]["quantidade"], grupo["props"]["pior_condicao"]) == (1, "boa")


# --- ocorrências abertas na data --------------------------------------------------------------


def test_ocorrencia_aberta_na_data_nao_inclui_as_fechadas_nem_as_registradas_depois(
    cliente, revisor, tipo_queda
):
    _ocorrencia(tipo_queda, revisor, registrada_ha=100)  # segue aberta
    _ocorrencia(
        tipo_queda,
        revisor,
        registrada_ha=100,
        estado="concluida",
        concluida_em=_atras(50),
    )
    cancelada = _ocorrencia(tipo_queda, revisor, registrada_ha=100)
    Ocorrencia.objects.filter(pk=cancelada.pk).update(estado="cancelada")  # cancelada agora
    _ocorrencia(tipo_queda, revisor, registrada_ha=10)  # registrada depois da data

    def abertas(dias):
        return _situacao(cliente, revisor, ate=_mes(dias))["ocorrencias_abertas"]

    assert abertas(150) == 0
    assert abertas(80) == 3  # as três de 100 dias atrás ainda estavam abertas
    assert abertas(50) == 2  # a concluída há 50 dias saiu; a cancelada (agora) ainda estava
    assert abertas(0) == 2  # a cancelada saiu; entrou a registrada há 10 dias


def test_tile_de_ocorrencias_na_data(cliente, revisor, tipo_queda):
    _ocorrencia(tipo_queda, revisor, registrada_ha=100, estado="concluida", concluida_em=_atras(50))
    lon, lat = PONTO_A["longitude"], PONTO_A["latitude"]
    z = 17
    x, y = _tile(lon, lat, z)

    def feicoes(**p):
        r = cliente.como(revisor).get(f"/api/v1/mapa/tiles/ocorrencias/{z}/{x}/{y}", p)
        return decodificar(r.content, z, x, y).get("ocorrencias", [])

    assert len(feicoes(ate=_mes(80))) == 1
    assert feicoes(ate=_mes(20)) == []
    assert feicoes() == []  # presente: concluída não é "aberta"
    assert len(feicoes(ate=_mes(20), estado="todas")) == 1


def test_intervalo_de_ocorrencias_inclui_as_que_fecharam_dentro_dele(cliente, revisor, tipo_queda):
    _ocorrencia(
        tipo_queda, revisor, registrada_ha=200, estado="concluida", concluida_em=_atras(100)
    )
    assert _situacao(cliente, revisor, ate=_mes(40))["ocorrencias_abertas"] == 0
    assert _situacao(cliente, revisor, desde=_mes(110), ate=_mes(40))["ocorrencias_abertas"] == 1


# --- alertas e focos --------------------------------------------------------------------------


def _alerta(dias, id_externo, tipo="foco_calor"):
    return AlertaAmbiental.objects.create(
        fonte="firms",
        id_externo=id_externo,
        tipo=tipo,
        geom=_ponto(PONTO_A),
        data_deteccao=_atras(dias),
        status="descartado",
    )


def test_alertas_do_mes_e_do_intervalo(cliente, gestor_municipal):
    revisor = gestor_municipal
    _alerta(100, "a")
    _alerta(30, "b")
    assert _situacao(cliente, revisor, ate=_mes(100))["alertas"] == 1
    assert _situacao(cliente, revisor, ate=_mes(65))["alertas"] == 0
    assert _situacao(cliente, revisor, desde=_mes(100), ate=_mes(30))["alertas"] == 2
    r = cliente.como(revisor).get("/api/v1/mapa/alertas", {"ate": _mes(100)})
    assert [f["properties"]["data_deteccao"][:7] for f in r.json()["features"]] == [_mes(100)]


def test_alertas_sem_ate_continuam_so_os_em_aberto(cliente, gestor_municipal):
    revisor = gestor_municipal
    _alerta(100, "a")  # descartado
    assert cliente.como(revisor).get("/api/v1/mapa/alertas").json()["features"] == []


# --- escopo, permissões e validação -----------------------------------------------------------


def test_escopo_limita_as_contagens(cliente, revisor, tecnico_a, tipo_queda):
    _arvore(PONTO_A)
    _arvore(PONTO_B)
    assert _situacao(cliente, revisor, ate=_mes(50))["arvores"] == 2
    assert _situacao(cliente, tecnico_a, ate=_mes(50))["arvores"] == 1


def test_escopo_limita_o_tile_na_data(cliente, tecnico_a):
    _arvore(PONTO_B)
    lon, lat = PONTO_B["longitude"], PONTO_B["latitude"]
    assert _tile_arvores(cliente, tecnico_a, lon, lat, ate=_mes(50)) == []


def test_contagem_de_camada_sem_permissao_vem_nula(cliente, db):
    sem = criar_usuario("sem@itree.teste", [])
    r = _situacao(cliente, sem, ate=_mes(0))
    assert r == {"arvores": None, "ocorrencias_abertas": None, "alertas": None}


@pytest.mark.parametrize("ate", ["2026-13", "26-03", "abc", "2026-3"])
def test_mes_invalido_responde_400(cliente, revisor, ate):
    assert (
        cliente.como(revisor).get("/api/v1/mapa/situacao-na-data", {"ate": ate}).status_code == 400
    )
    x, y = _tile(PONTO_A["longitude"], PONTO_A["latitude"], 17)
    r = cliente.como(revisor).get(f"/api/v1/mapa/tiles/arvores/17/{x}/{y}", {"ate": ate})
    assert r.status_code == 400


def test_desde_depois_de_ate_responde_400(cliente, revisor):
    r = cliente.como(revisor).get(
        "/api/v1/mapa/situacao-na-data", {"desde": "2026-05", "ate": "2026-03"}
    )
    assert r.status_code == 400


def test_situacao_exige_ate(cliente, revisor):
    assert cliente.como(revisor).get("/api/v1/mapa/situacao-na-data").status_code == 400


# --- série mensal -----------------------------------------------------------------------------


def test_serie_mensal_sem_lacunas_e_com_zeros(cliente, gestor_municipal, tipo_queda):
    revisor = gestor_municipal
    _arvore(cadastrada_ha=100)
    _arvore(cadastrada_ha=100)
    _arvore(cadastrada_ha=10)
    _ocorrencia(tipo_queda, revisor, registrada_ha=65)
    _alerta(100, "a")
    r = cliente.como(revisor).get("/api/v1/mapa/serie-temporal")
    assert r.status_code == 200
    corpo = r.json()
    assert corpo["primeiro_mes"] == _mes(100)
    assert corpo["ultimo_mes"] == _mes(0)
    meses = {m["mes"]: m for m in corpo["meses"]}
    assert len(meses) == len(corpo["meses"])  # um por mês
    assert [m["mes"] for m in corpo["meses"]] == sorted(meses)
    assert meses[_mes(100)]["arvores"] == 2 and meses[_mes(100)]["alertas"] == 1
    assert meses[_mes(65)]["ocorrencias"] == 1
    assert sum(m["arvores"] for m in corpo["meses"]) == 3
    assert sum(m["ocorrencias"] for m in corpo["meses"]) == 1
    # Todos os meses entre o primeiro e o atual existem, mesmo sem dado.
    assert any(m["arvores"] == 0 and m["ocorrencias"] == 0 for m in corpo["meses"])


def test_serie_respeita_escopo_e_permissao(cliente, revisor, tecnico_a):
    _arvore(PONTO_A, cadastrada_ha=100)
    _arvore(PONTO_B, cadastrada_ha=100)
    do_revisor = cliente.como(revisor).get("/api/v1/mapa/serie-temporal").json()
    do_tecnico = cliente.como(tecnico_a).get("/api/v1/mapa/serie-temporal").json()
    assert sum(m["arvores"] for m in do_revisor["meses"]) == 2
    assert sum(m["arvores"] for m in do_tecnico["meses"]) == 1
    sem = criar_usuario("sem2@itree.teste", [])
    vazio = cliente.como(sem).get("/api/v1/mapa/serie-temporal").json()
    assert vazio["primeiro_mes"] is None and vazio["meses"] == []


def test_serie_usa_poucas_consultas(cliente, revisor, django_assert_max_num_queries):
    _arvore()
    with django_assert_max_num_queries(12):
        assert cliente.como(revisor).get("/api/v1/mapa/serie-temporal").status_code == 200
