"""G-01: da inspeção ao atendimento, com a ocorrência e a tarefa vinculadas à origem."""

from datetime import timedelta

import pytest
from django.utils import timezone

from itree.inspecoes.models import Inspecao
from itree.ocorrencias.models import Ocorrencia
from itree.tarefas.models import Tarefa

from .conftest import PONTO_A, com_escopo, criar_usuario
from .test_f2 import enviada

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


@pytest.fixture
def revisor_coordenador(territorios):
    """Quem revisa e também cria tarefas (as duas permissões juntas)."""
    return com_escopo(
        criar_usuario("rc@itree.teste", ["revisor", "coordenador"]), territorios["municipio"]
    )


def url(ins, acao="validar-e-encaminhar"):
    return f"/api/v1/inspecoes/{ins}/{acao}"


# --- G-01: validar e encaminhar -------------------------------------------------


def test_validar_e_encaminhar_valida_e_abre_a_ocorrencia_vinculada(
    cliente,
    tecnico_a,
    revisor,
    arvore_a,
    tipo_queda,
):
    ins = enviada(
        cliente, tecnico_a, arvore_a["id"], requer_encaminhamento=True, observacoes="Galho solto"
    )
    r = cliente.como(revisor).post(
        url(ins),
        {"aplicar": ["condicao_aparente"], "tipo_id": str(tipo_queda.id)},
        format="json",
    )
    assert r.status_code == 200, r.json()
    corpo = r.json()
    assert corpo["inspecao"]["estado"] == "validada"
    assert corpo["tarefa"] is None
    oco = Ocorrencia.objects.get()
    assert corpo["ocorrencia"] == {"id": str(oco.id), "codigo": oco.codigo}
    # Vinculada à inspeção e à árvore, com a origem declarada e sem decisão da gestão.
    assert str(oco.inspecao_id) == ins
    assert str(oco.arvore_id) == arvore_a["id"]
    assert (oco.origem, oco.origem_referencia) == ("inspecao", Inspecao.objects.get().codigo)
    assert oco.descricao == "Galho solto"
    assert oco.prazo == timezone.localdate() + timedelta(days=3)  # prazo padrão do tipo
    assert (oco.prioridade, oco.risco_confirmado, oco.estado) == ("", False, "aberta")
    assert "galhos secos" in oco.condicao_aparente
    # A inspeção passa a apontar para a ocorrência gerada.
    detalhe = cliente.get(f"/api/v1/inspecoes/{ins}").json()
    assert detalhe["ocorrencias_geradas"] == [
        {"id": str(oco.id), "codigo": oco.codigo, "estado": "aberta"}
    ]
    # E a ocorrência mostra a origem, com link.
    r = cliente.get(f"/api/v1/ocorrencias/{oco.id}").json()
    assert r["origem_vinculo"] == {
        "tipo": "inspecao",
        "id": ins,
        "codigo": Inspecao.objects.get().codigo,
    }


def test_encaminhar_com_tarefa_traz_a_tarefa_vinculada_e_a_origem(
    cliente,
    tecnico_a,
    revisor_coordenador,
    arvore_a,
    tipo_queda,
):
    ins = enviada(cliente, tecnico_a, arvore_a["id"], observacoes="Risco de queda")
    r = cliente.como(revisor_coordenador).post(
        url(ins),
        {
            "aplicar": [],
            "tipo_id": str(tipo_queda.id),
            "criar_tarefa": True,
            "responsavel_id": str(tecnico_a.id),
        },
        format="json",
    )
    assert r.status_code == 200, r.json()
    tarefa = Tarefa.objects.get()
    assert r.json()["tarefa"] == {"id": str(tarefa.id), "codigo": tarefa.codigo}
    assert (tarefa.tipo, tarefa.estado) == ("atendimento_ocorrencia", "nao_iniciada")
    assert tarefa.ocorrencia == Ocorrencia.objects.get()
    assert tarefa.responsavel == tecnico_a
    # A ocorrência lista as tarefas vinculadas, com estado.
    oco = cliente.get(f"/api/v1/ocorrencias/{tarefa.ocorrencia_id}").json()
    assert [(t["codigo"], t["estado"]) for t in oco["tarefas"]] == [(tarefa.codigo, "nao_iniciada")]
    # A tarefa mostra de qual inspeção veio o trabalho.
    t = cliente.get(f"/api/v1/tarefas/{tarefa.id}").json()
    assert t["origem"] == {"tipo": "inspecao", "id": ins, "codigo": Inspecao.objects.get().codigo}


def test_encaminhar_e_tudo_ou_nada(cliente, tecnico_a, revisor, arvore_a, tipo_queda):
    """Sem texto para a ocorrência, a inspeção também não é validada."""
    ins = enviada(cliente, tecnico_a, arvore_a["id"])  # sem observações
    r = cliente.como(revisor).post(
        url(ins), {"aplicar": ["condicao_aparente"], "tipo_id": str(tipo_queda.id)}, format="json"
    )
    assert r.status_code == 400
    assert Inspecao.objects.get().estado == "em_revisao"
    assert Ocorrencia.objects.count() == 0
    # Com a descrição informada, passa.
    r = cliente.post(
        url(ins),
        {"aplicar": [], "tipo_id": str(tipo_queda.id), "descricao": "Avaliar o galho"},
        format="json",
    )
    assert r.status_code == 200, r.json()


def test_responsavel_fora_do_escopo_desfaz_o_encaminhamento(
    cliente,
    tecnico_a,
    revisor_coordenador,
    arvore_a,
    tipo_queda,
    territorios,
):
    ins = enviada(cliente, tecnico_a, arvore_a["id"], observacoes="x")
    de_b = com_escopo(criar_usuario("b@itree.teste", ["tecnico"]), territorios["b"])
    r = cliente.como(revisor_coordenador).post(
        url(ins),
        {
            "aplicar": [],
            "tipo_id": str(tipo_queda.id),
            "criar_tarefa": True,
            "responsavel_id": str(de_b.id),
        },
        format="json",
    )
    assert r.status_code == 400
    assert Inspecao.objects.get().estado == "em_revisao"
    assert (Ocorrencia.objects.count(), Tarefa.objects.count()) == (0, 0)


def test_encaminhar_exige_poder_registrar_ocorrencia_e_nao_repete(
    cliente,
    tecnico_a,
    revisor,
    arvore_a,
    tipo_queda,
    gestor_municipal,
):
    ins = enviada(cliente, tecnico_a, arvore_a["id"], observacoes="x")
    corpo = {"aplicar": [], "tipo_id": str(tipo_queda.id)}
    # Técnico não valida; gestor municipal não tem "inspecoes.validar".
    assert cliente.como(tecnico_a).post(url(ins), corpo, format="json").status_code == 403
    assert cliente.como(gestor_municipal).post(url(ins), corpo, format="json").status_code == 403
    assert cliente.como(revisor).post(url(ins), corpo, format="json").status_code == 200
    # Reenviar não abre uma segunda ocorrência.
    assert cliente.post(url(ins), corpo, format="json").status_code == 400
    assert Ocorrencia.objects.count() == 1


def test_tarefa_exige_permissao_de_criar_tarefas(
    cliente,
    tecnico_a,
    revisor,
    arvore_a,
    tipo_queda,
):
    ins = enviada(cliente, tecnico_a, arvore_a["id"], observacoes="x")
    assert not revisor.tem_permissao("tarefas.editar")
    r = cliente.como(revisor).post(
        url(ins),
        {"aplicar": [], "tipo_id": str(tipo_queda.id), "criar_tarefa": True},
        format="json",
    )
    assert r.status_code == 403
    assert Inspecao.objects.get().estado == "em_revisao"
