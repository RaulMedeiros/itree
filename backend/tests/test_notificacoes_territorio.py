"""M-27: notificações só de bairros escolhidos e "silenciar até" uma data."""

# ruff: noqa: F811 (as fixtures vêm importadas de outro módulo de teste)

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from itree.alertas.models import AlertaAmbiental
from itree.contas.models import Equipe
from itree.notificacoes import servicos, tasks
from itree.notificacoes.models import AjustesNotificacao, Notificacao

from .conftest import PONTO_A, PONTO_B, com_escopo, criar_usuario
from .test_notificacoes_preferencias import (  # noqa: F401
    atribuir_a_equipe,
    coordenador,
    definir,
    enfileiradas,
    executar,
)

pytestmark = pytest.mark.django_db

AJUSTES = "/api/v1/notificacoes/ajustes"


@pytest.fixture
def tecnico_municipal(territorios):
    """Técnico com escopo em todo o município: recebe de A e de B, salvo se escolher bairros."""
    return com_escopo(criar_usuario("tm@itree.teste", ["tecnico"]), territorios["municipio"])


def criar_arvore(cliente, revisor, ponto):
    return (
        cliente.como(revisor).post("/api/v1/arvores", {"localizacao": ponto}, format="json").json()
    )


def ajustar(cliente, usuario, **corpo):
    return cliente.como(usuario).put(AJUSTES, corpo, format="json")


# --- Ajustes (API) ---------------------------------------------------------------


def test_sem_ajustes_recebe_de_todo_o_escopo_e_nao_esta_silenciada(cliente, tecnico_municipal):
    r = cliente.como(tecnico_municipal).get(AJUSTES)
    assert r.status_code == 200
    assert r.json() == {"territorios": [], "silenciada_ate": None, "silenciada": False}


def test_salva_bairros_e_silencio_e_devolve_nomes(cliente, tecnico_municipal, territorios):
    ate = (timezone.localdate() + timedelta(days=10)).isoformat()
    r = ajustar(
        cliente, tecnico_municipal, territorios_ids=[str(territorios["b"].pk)], silenciada_ate=ate
    )
    assert r.status_code == 200, r.json()
    assert r.json() == {
        "territorios": [{"id": str(territorios["b"].pk), "nome": "Bairro B"}],
        "silenciada_ate": ate,
        "silenciada": True,
    }
    # Só o que vem no corpo muda; lista vazia e data nula desfazem.
    assert ajustar(cliente, tecnico_municipal, silenciada_ate=None).json()["territorios"] != []
    r = ajustar(cliente, tecnico_municipal, territorios_ids=[])
    assert r.json() == {"territorios": [], "silenciada_ate": None, "silenciada": False}


def test_so_bairros_dentro_do_escopo_e_data_de_hoje_em_diante(cliente, tecnico_a, territorios):
    fora = ajustar(cliente, tecnico_a, territorios_ids=[str(territorios["b"].pk)])
    assert fora.status_code == 400  # o Bairro B está fora do escopo do técnico
    municipio = ajustar(cliente, tecnico_a, territorios_ids=[str(territorios["municipio"].pk)])
    assert municipio.status_code == 400  # município não é bairro
    inexistente = ajustar(
        cliente, tecnico_a, territorios_ids=["01a1d559-2b25-77a1-833a-e1ead49fa236"]
    )
    assert inexistente.status_code == 400
    ontem = (timezone.localdate() - timedelta(days=1)).isoformat()
    assert ajustar(cliente, tecnico_a, silenciada_ate=ontem).status_code == 400
    assert (
        ajustar(cliente, tecnico_a, territorios_ids=[str(territorios["a"].pk)]).status_code == 200
    )


def test_data_passada_gravada_nao_conta_como_silencio(cliente, tecnico_municipal):
    AjustesNotificacao.objects.create(
        usuario=tecnico_municipal, silenciada_ate=timezone.localdate() - timedelta(days=1)
    )
    assert cliente.como(tecnico_municipal).get(AJUSTES).json()["silenciada"] is False


def test_ajustes_sao_de_cada_pessoa(cliente, tecnico_municipal, revisor, territorios):
    ajustar(cliente, tecnico_municipal, territorios_ids=[str(territorios["a"].pk)])
    assert cliente.como(revisor).get(AJUSTES).json()["territorios"] == []


# --- Efeito nas notificações -------------------------------------------------------


def test_silenciar_ate_uma_data_nao_gera_notificacao_nem_email(
    cliente,
    executar,
    coordenador,
    tecnico_municipal,
    revisor,
    enfileiradas,  # noqa: F811
):
    arvore = criar_arvore(cliente, revisor, PONTO_A)
    definir(cliente, tecnico_municipal, tarefa_atribuida={"ativa": True, "email": True})
    ajustar(
        cliente, tecnico_municipal, silenciada_ate=(timezone.localdate()).isoformat()
    )  # inclusive: hoje ainda silencia
    with executar():
        atribuir_a_equipe(cliente, coordenador, tecnico_municipal, arvore)
    assert not Notificacao.objects.filter(usuario=tecnico_municipal).exists()
    assert enfileiradas == []


def test_passada_a_data_volta_a_notificar(
    cliente,
    executar,
    coordenador,
    tecnico_municipal,
    revisor,
    enfileiradas,  # noqa: F811
):
    arvore = criar_arvore(cliente, revisor, PONTO_A)
    AjustesNotificacao.objects.create(
        usuario=tecnico_municipal, silenciada_ate=timezone.localdate() - timedelta(days=1)
    )
    with executar():
        atribuir_a_equipe(cliente, coordenador, tecnico_municipal, arvore)
    assert Notificacao.objects.filter(usuario=tecnico_municipal).count() == 1


def test_so_notifica_dos_bairros_escolhidos(
    cliente,
    executar,
    coordenador,
    tecnico_municipal,
    revisor,
    territorios,
    enfileiradas,  # noqa: F811
):
    em_a = criar_arvore(cliente, revisor, PONTO_A)
    em_b = criar_arvore(cliente, revisor, PONTO_B)
    ajustar(cliente, tecnico_municipal, territorios_ids=[str(territorios["b"].pk)])
    with executar():
        atribuir_a_equipe(cliente, coordenador, tecnico_municipal, em_a)
    assert not Notificacao.objects.filter(usuario=tecnico_municipal).exists()
    Equipe.objects.update(nome="Poda anterior")  # o nome da equipe de teste é único
    with executar():
        atribuir_a_equipe(cliente, coordenador, tecnico_municipal, em_b)
    assert Notificacao.objects.filter(usuario=tecnico_municipal).count() == 1


def test_sem_bairros_escolhidos_recebe_de_todo_o_escopo(
    cliente,
    executar,
    coordenador,
    tecnico_municipal,
    revisor,
    enfileiradas,  # noqa: F811
):
    em_b = criar_arvore(cliente, revisor, PONTO_B)
    with executar():
        atribuir_a_equipe(cliente, coordenador, tecnico_municipal, em_b)
    assert Notificacao.objects.filter(usuario=tecnico_municipal).count() == 1


def test_aviso_de_alertas_conta_so_os_dos_bairros_escolhidos(cliente, executar, territorios):
    def alerta(n, ponto):
        return AlertaAmbiental.objects.create(
            fonte="inpe_focos",
            id_externo=f"F{n}",
            tipo="foco_calor",
            geom=Point(ponto["longitude"], ponto["latitude"], srid=4326),
            data_deteccao=timezone.now(),
        )

    em_a, em_b1, em_b2 = alerta(1, PONTO_A), alerta(2, PONTO_B), alerta(3, PONTO_B)
    com_escopo_b = com_escopo(
        criar_usuario("alertas@itree.teste", ["analista_ambiental"]), territorios["municipio"]
    )
    sem_ajustes = com_escopo(
        criar_usuario("todos@itree.teste", ["analista_ambiental"]), territorios["municipio"]
    )
    ajustar(cliente, com_escopo_b, territorios_ids=[str(territorios["b"].pk)])
    with executar():
        servicos.alertas_novos([em_a, em_b1, em_b2])
    assert Notificacao.objects.get(usuario=com_escopo_b).titulo == "2 novos alertas ambientais"
    # Quem não escolheu bairros continua vendo os três.
    assert Notificacao.objects.get(usuario=sem_ajustes).titulo == "3 novos alertas ambientais"
    # Só os bairros escolhidos: se nenhum alerta cai neles, nenhum aviso.
    ajustar(cliente, com_escopo_b, territorios_ids=[str(territorios["a"].pk)])
    Notificacao.objects.all().delete()
    with executar():
        servicos.alertas_novos([em_b1, em_b2])
    assert not Notificacao.objects.filter(usuario=com_escopo_b).exists()


def test_inspecao_devolvida_tambem_respeita_o_silencio(cliente, executar, tecnico_municipal):
    class Insp:
        codigo = "INS-000001"
        pk = "i"
        tecnico = tecnico_municipal

    ajustar(cliente, tecnico_municipal, silenciada_ate=timezone.localdate().isoformat())
    with executar():
        servicos.inspecao_devolvida(Insp, "Foto borrada")
    assert not Notificacao.objects.exists()


def test_email_nao_e_enfileirado_sem_notificacao(enfileiradas):  # noqa: F811
    assert tasks.enfileirar_emails([]) is None and enfileiradas == []
