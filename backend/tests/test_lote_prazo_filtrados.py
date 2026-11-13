"""M-23: "Definir prazo" em lote e ação sobre todos os registros filtrados."""

from datetime import date

import pytest

from itree.contas.models import Equipe
from itree.core import lote
from itree.ocorrencias.models import Ocorrencia
from itree.tarefas.models import Tarefa

from .conftest import PONTO_B, com_escopo, criar_usuario
from .test_lote_listas import OCORRENCIAS, TAREFAS, coordenador, ids, ocorrencia, tarefa  # noqa: F401

pytestmark = pytest.mark.django_db


# --- Definir prazo ---------------------------------------------------------------


def test_prazo_em_lote_define_e_registra_no_historico(cliente, gestor_municipal, tipo_queda):
    a, b = ocorrencia(gestor_municipal, tipo_queda), ocorrencia(gestor_municipal, tipo_queda)
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo",
        {"ids": ids(a, b), "prazo": "2026-12-15", "motivo": "Prazo do mutirão"},
        format="json",
    )
    assert r.status_code == 200, r.json()
    assert r.json() == {"atualizadas": 2, "ignoradas": []}
    assert set(Ocorrencia.objects.values_list("prazo", flat=True)) == {date(2026, 12, 15)}
    evento = cliente.get(f"{OCORRENCIAS}/{a.pk}/historico").json()[0]["contexto"]
    assert evento["evento"] == "prazo_definido_em_lote"
    assert evento["motivo"] == "Prazo do mutirão"


def test_prazo_nulo_remove_o_prazo(cliente, gestor_municipal, tipo_queda):
    a = ocorrencia(gestor_municipal, tipo_queda, prazo=date(2026, 12, 1))
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo", {"ids": ids(a), "prazo": None}, format="json"
    )
    assert r.status_code == 200
    a.refresh_from_db()
    assert a.prazo is None


def test_prazo_e_obrigatorio_no_corpo_e_valida_a_data(cliente, gestor_municipal, tipo_queda):
    a = ocorrencia(gestor_municipal, tipo_queda)
    cliente.como(gestor_municipal)
    assert (
        cliente.post(f"{OCORRENCIAS}/lote/prazo", {"ids": ids(a)}, format="json").status_code == 400
    )
    assert (
        cliente.post(
            f"{OCORRENCIAS}/lote/prazo", {"ids": ids(a), "prazo": "31/12/2026"}, format="json"
        ).status_code
        == 400
    )


def test_prazo_em_lote_ignora_encerradas_e_exige_edicao(
    cliente, gestor_municipal, tipo_queda, territorios
):
    aberta = ocorrencia(gestor_municipal, tipo_queda)
    cancelada = ocorrencia(gestor_municipal, tipo_queda, estado="cancelada")
    corpo = {"ids": ids(aberta, cancelada), "prazo": "2026-12-15"}
    consulta = com_escopo(
        criar_usuario("consulta@itree.teste", ["consulta"]), territorios["municipio"]
    )
    assert (
        cliente.como(consulta).post(f"{OCORRENCIAS}/lote/prazo", corpo, format="json").status_code
        == 403
    )
    r = cliente.como(gestor_municipal).post(f"{OCORRENCIAS}/lote/prazo", corpo, format="json")
    assert r.json()["atualizadas"] == 1
    assert r.json()["ignoradas"][0]["codigo"] == cancelada.codigo
    cancelada.refresh_from_db()
    assert cancelada.prazo is None


def test_prazo_em_lote_de_tarefas(cliente, coordenador):  # noqa: F811
    a, b = tarefa(coordenador), tarefa(coordenador, estado="concluida")
    r = cliente.como(coordenador).post(
        f"{TAREFAS}/lote/prazo", {"ids": ids(a, b), "prazo": "2026-12-20"}, format="json"
    )
    assert r.status_code == 200, r.json()
    assert r.json()["atualizadas"] == 1
    assert r.json()["ignoradas"][0]["codigo"] == b.codigo
    a.refresh_from_db()
    b.refresh_from_db()
    assert a.prazo == date(2026, 12, 20) and b.prazo is None


# --- Todos os filtrados ----------------------------------------------------------


def test_ocorrencias_filtradas_recebem_a_acao_sem_ids(cliente, gestor_municipal, tipo_queda):
    altas = [ocorrencia(gestor_municipal, tipo_queda, prioridade="alta") for _ in range(3)]
    baixa = ocorrencia(gestor_municipal, tipo_queda, prioridade="baixa")
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo",
        {"filtros": {"prioridade": "alta"}, "prazo": "2026-12-15"},
        format="json",
    )
    assert r.status_code == 200, r.json()
    assert r.json()["atualizadas"] == 3
    assert {o.pk for o in Ocorrencia.objects.filter(prazo=date(2026, 12, 15))} == {
        o.pk for o in altas
    }
    baixa.refresh_from_db()
    assert baixa.prazo is None


def test_filtrados_respeitam_o_escopo_territorial(cliente, tecnico_a, gestor_municipal, tipo_queda):
    dentro = ocorrencia(gestor_municipal, tipo_queda)
    fora = ocorrencia(gestor_municipal, tipo_queda, ponto=PONTO_B)
    r = cliente.como(tecnico_a).post(
        f"{OCORRENCIAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-15"}, format="json"
    )
    assert r.status_code == 200, r.json()
    assert r.json()["atualizadas"] == 1
    fora.refresh_from_db()
    dentro.refresh_from_db()
    assert fora.prazo is None and dentro.prazo == date(2026, 12, 15)


def test_filtrados_alem_do_limite_sao_recusados_sem_alterar_nada(
    cliente, gestor_municipal, tipo_queda, monkeypatch
):
    monkeypatch.setattr(lote, "LIMITE_ACOES_EM_LOTE", 1)
    monkeypatch.setattr(lote, "LIMITE_OPERACAO_EM_LOTE", 2)
    for _ in range(3):
        ocorrencia(gestor_municipal, tipo_queda)
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-15"}, format="json"
    )
    assert r.status_code == 400
    aviso = str(r.json())
    assert "3 registros" in aviso and "limite" in aviso
    assert not Ocorrencia.objects.filter(prazo__isnull=False).exists()


def test_ids_e_filtros_juntos_ou_nenhum_dos_dois_sao_recusados(
    cliente, gestor_municipal, tipo_queda
):
    a = ocorrencia(gestor_municipal, tipo_queda)
    cliente.como(gestor_municipal)
    ambos = {"ids": ids(a), "filtros": {}, "prazo": "2026-12-15"}
    assert cliente.post(f"{OCORRENCIAS}/lote/prazo", ambos, format="json").status_code == 400
    nenhum = {"prazo": "2026-12-15"}
    assert cliente.post(f"{OCORRENCIAS}/lote/prazo", nenhum, format="json").status_code == 400


def test_filtros_sem_resultado_sao_recusados(cliente, gestor_municipal, tipo_queda):
    ocorrencia(gestor_municipal, tipo_queda, prioridade="baixa")
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo",
        {"filtros": {"prioridade": "urgente"}, "prazo": "2026-12-15"},
        format="json",
    )
    assert r.status_code == 400


def test_filtrados_valem_tambem_para_reatribuir_e_prioridade(cliente, gestor_municipal, tipo_queda):
    ocorrencia(gestor_municipal, tipo_queda)
    equipe = Equipe.objects.create(nome="Poda A")
    cliente.como(gestor_municipal)
    r = cliente.post(
        f"{OCORRENCIAS}/lote/reatribuir",
        {"filtros": {}, "equipe_id": str(equipe.pk)},
        format="json",
    )
    assert r.status_code == 200 and r.json()["atualizadas"] == 1
    r = cliente.post(
        f"{OCORRENCIAS}/lote/prioridade", {"filtros": {}, "prioridade": "alta"}, format="json"
    )
    assert r.status_code == 200 and r.json()["atualizadas"] == 1


def test_tarefas_filtradas_seguem_o_padrao_da_lista_so_abertas(cliente, coordenador):  # noqa: F811
    aberta = tarefa(coordenador)
    concluida = tarefa(coordenador, estado="concluida")
    r = cliente.como(coordenador).post(
        f"{TAREFAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-20"}, format="json"
    )
    assert r.status_code == 200, r.json()
    assert r.json() == {"atualizadas": 1, "ignoradas": []}
    aberta.refresh_from_db()
    concluida.refresh_from_db()
    assert aberta.prazo == date(2026, 12, 20) and concluida.prazo is None


def test_tarefas_filtradas_por_responsavel_eu_e_limite(cliente, coordenador, monkeypatch):  # noqa: F811
    minha = tarefa(coordenador, responsavel=coordenador)
    de_outro = tarefa(coordenador)
    r = cliente.como(coordenador).post(
        f"{TAREFAS}/lote/prazo",
        {"filtros": {"responsavel": "eu"}, "prazo": "2026-12-20"},
        format="json",
    )
    assert r.json()["atualizadas"] == 1
    minha.refresh_from_db()
    de_outro.refresh_from_db()
    assert minha.prazo is not None and de_outro.prazo is None
    monkeypatch.setattr(lote, "LIMITE_ACOES_EM_LOTE", 1)
    monkeypatch.setattr(lote, "LIMITE_OPERACAO_EM_LOTE", 1)
    r = cliente.post(f"{TAREFAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-21"}, format="json")
    assert r.status_code == 400
    assert not Tarefa.objects.filter(prazo=date(2026, 12, 21)).exists()
