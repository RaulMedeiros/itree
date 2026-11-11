"""R2-11: sair de "Bloqueada" exige o motivo do desbloqueio."""

import pytest

from itree.tarefas.models import Tarefa

from .conftest import PONTO_A, com_escopo, criar_usuario

pytestmark = pytest.mark.django_db


@pytest.fixture
def arvore_a(cliente, revisor):
    return (
        cliente.como(revisor)
        .post("/api/v1/arvores", {"localizacao": PONTO_A}, format="json")
        .json()
    )


@pytest.fixture
def coordenador(territorios):
    return com_escopo(criar_usuario("coord@itree.teste", ["coordenador"]), territorios["municipio"])


# --- R2-11: tarefa bloqueada ------------------------------------------------------


def test_desbloquear_tarefa_exige_motivo(cliente, coordenador, tecnico_a, arvore_a):
    t = cliente.como(coordenador).post(
        "/api/v1/tarefas",
        {
            "tipo": "inspecao_arvore",
            "arvore_id": arvore_a["id"],
            "responsavel_id": str(tecnico_a.id),
        },
        format="json",
    )
    assert t.status_code == 201, t.json()
    transicao = f"/api/v1/tarefas/{t.json()['id']}/transicao"
    cliente.post(transicao, {"estado": "bloqueada", "motivo": "Obra no local"}, format="json")
    for destino in ("nao_iniciada", "em_execucao"):
        r = cliente.post(transicao, {"estado": destino}, format="json")
        assert r.status_code == 400, destino
    assert Tarefa.objects.get().estado == "bloqueada"
    r = cliente.post(
        transicao, {"estado": "nao_iniciada", "motivo": "Obra terminou"}, format="json"
    )
    assert r.status_code == 200, r.json()
    assert r.json()["estado"] == "nao_iniciada"
