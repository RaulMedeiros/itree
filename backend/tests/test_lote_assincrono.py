"""M-26: ações em lote acima de 200 registros rodam em tarefa Celery, com acompanhamento."""

from datetime import date

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from itree.alertas.models import AlertaAmbiental, StatusAlerta
from itree.contas.models import Usuario
from itree.core import lote
from itree.core.models import EstadoOperacao, OperacaoEmLote
from itree.core.tasks import executar_operacao_em_lote
from itree.ocorrencias.models import Ocorrencia
from itree.tarefas.models import Tarefa

from .conftest import PONTO_A, com_escopo, criar_usuario
from .test_lote_listas import OCORRENCIAS, TAREFAS, coordenador, ids, ocorrencia, tarefa  # noqa: F401

pytestmark = pytest.mark.django_db

ALERTAS = "/api/v1/alertas"
OPERACOES = "/api/v1/operacoes-em-lote"


@pytest.fixture
def fila(monkeypatch):
    """A fila de teste: guarda as operações enfileiradas e deixa executar quando quiser."""
    enfileiradas: list[str] = []
    monkeypatch.setattr(executar_operacao_em_lote, "delay", lambda i: enfileiradas.append(i))
    return enfileiradas


@pytest.fixture
def limite_baixo(monkeypatch):
    """Dois registros já passam do limite síncrono, sem criar 200 linhas por teste."""
    monkeypatch.setattr(lote, "LIMITE_ACOES_EM_LOTE", 2)


def alerta(n: int, **extras) -> AlertaAmbiental:
    return AlertaAmbiental.objects.create(
        fonte="inpe_focos",
        id_externo=f"F{n}",
        tipo="foco_calor",
        geom=Point(PONTO_A["longitude"], PONTO_A["latitude"], srid=4326),
        data_deteccao=timezone.now(),
        **extras,
    )


@pytest.fixture
def analista(territorios):
    return com_escopo(
        criar_usuario("ana@itree.teste", ["analista_ambiental"]), territorios["municipio"]
    )


def test_acima_do_limite_cria_operacao_e_nao_altera_nada_ainda(
    cliente, gestor_municipal, tipo_queda, fila, limite_baixo
):
    for _ in range(3):
        ocorrencia(gestor_municipal, tipo_queda)
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo",
        {"filtros": {}, "prazo": "2026-12-15", "motivo": "Mutirão"},
        format="json",
    )
    assert r.status_code == 202, r.json()
    corpo = r.json()
    assert corpo["estado"] == "pendente"
    assert (corpo["total"], corpo["processados"], corpo["atualizadas"]) == (3, 0, 0)
    assert fila == [corpo["id"]]
    assert not Ocorrencia.objects.filter(prazo__isnull=False).exists()


def test_execucao_altera_registra_andamento_e_historico(
    cliente, gestor_municipal, tipo_queda, fila, limite_baixo, monkeypatch
):
    monkeypatch.setattr(lote, "TAMANHO_BLOCO", 2)
    todas = [ocorrencia(gestor_municipal, tipo_queda) for _ in range(5)]
    encerrada = ocorrencia(gestor_municipal, tipo_queda, estado="cancelada")
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo",
        {"filtros": {}, "prazo": "2026-12-15", "motivo": "Mutirão"},
        format="json",
    )
    assert r.status_code == 202, r.json()
    executar_operacao_em_lote(fila[0])

    r = cliente.get(f"{OPERACOES}/{fila[0]}")
    assert r.status_code == 200
    op = r.json()
    assert op["estado"] == "concluida"
    assert (op["total"], op["processados"], op["atualizadas"], op["falhas"]) == (6, 6, 5, 1)
    assert op["motivos"] == [
        {"id": str(encerrada.pk), "codigo": encerrada.codigo, "motivo": "Já foi encerrada."}
    ]
    assert op["concluida_em"]
    assert {o.prazo for o in Ocorrencia.objects.filter(pk__in=[o.pk for o in todas])} == {
        date(2026, 12, 15)
    }
    evento = cliente.get(f"{OCORRENCIAS}/{todas[0].pk}/historico").json()[0]
    assert evento["contexto"]["evento"] == "prazo_definido_em_lote"
    assert evento["contexto"]["motivo"] == "Mutirão"
    assert evento["contexto"]["user"] == str(gestor_municipal.pk)  # quem pediu, fora da requisição
    assert evento["contexto"]["operacao"] == fila[0]


def test_erro_em_um_registro_nao_derruba_os_demais(
    cliente, gestor_municipal, tipo_queda, fila, limite_baixo, monkeypatch
):
    a, b, c = (ocorrencia(gestor_municipal, tipo_queda) for _ in range(3))
    cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-15"}, format="json"
    )
    original = Ocorrencia.save

    def salvar(self, *args, **kwargs):
        if self.pk == b.pk:
            raise RuntimeError("falha simulada")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Ocorrencia, "save", salvar)
    executar_operacao_em_lote(fila[0])
    op = OperacaoEmLote.objects.get()
    assert op.estado == EstadoOperacao.CONCLUIDA
    assert (op.atualizadas, op.falhas) == (2, 1)
    assert op.motivos[0]["id"] == str(b.pk)
    monkeypatch.undo()
    assert Ocorrencia.objects.get(pk=a.pk).prazo == date(2026, 12, 15)
    assert Ocorrencia.objects.get(pk=b.pk).prazo is None
    assert Ocorrencia.objects.get(pk=c.pk).prazo == date(2026, 12, 15)


def test_falha_geral_marca_a_operacao_como_interrompida(
    cliente, gestor_municipal, tipo_queda, fila, limite_baixo, monkeypatch
):
    for _ in range(3):
        ocorrencia(gestor_municipal, tipo_queda)
    cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-15"}, format="json"
    )
    monkeypatch.setattr(lote, "aplicar_a_ids", lambda *a, **k: 1 / 0)
    executar_operacao_em_lote(fila[0])
    op = OperacaoEmLote.objects.get()
    assert op.estado == EstadoOperacao.FALHOU
    assert "interrompida" in op.erro and op.concluida_em


def test_operacao_so_e_visivel_a_quem_pediu(
    cliente, gestor_municipal, tipo_queda, fila, limite_baixo, revisor
):
    for _ in range(3):
        ocorrencia(gestor_municipal, tipo_queda)
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-15"}, format="json"
    )
    id_ = r.json()["id"]
    assert cliente.get(f"{OPERACOES}/{id_}").status_code == 200
    assert cliente.como(revisor).get(f"{OPERACOES}/{id_}").status_code == 404


def test_reexecutar_operacao_ja_iniciada_nao_repete(
    cliente, gestor_municipal, tipo_queda, fila, limite_baixo
):
    for _ in range(3):
        ocorrencia(gestor_municipal, tipo_queda)
    cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-15"}, format="json"
    )
    executar_operacao_em_lote(fila[0])
    Ocorrencia.objects.update(prazo=None)
    executar_operacao_em_lote(fila[0])  # a mesma mensagem entregue de novo
    assert not Ocorrencia.objects.filter(prazo__isnull=False).exists()


def test_fila_indisponivel_falha_a_operacao_em_vez_de_deixa_la_na_fila(
    cliente, gestor_municipal, tipo_queda, limite_baixo, monkeypatch
):
    def sem_fila(_):
        raise ConnectionError("sem broker")

    monkeypatch.setattr(executar_operacao_em_lote, "delay", sem_fila)
    for _ in range(3):
        ocorrencia(gestor_municipal, tipo_queda)
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-15"}, format="json"
    )
    assert r.status_code == 202
    assert r.json()["estado"] == "falhou" and "fila" in r.json()["erro"]


def test_acima_do_teto_da_operacao_continua_recusado(
    cliente, gestor_municipal, tipo_queda, fila, limite_baixo, monkeypatch
):
    monkeypatch.setattr(lote, "LIMITE_OPERACAO_EM_LOTE", 4)
    for _ in range(5):
        ocorrencia(gestor_municipal, tipo_queda)
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-15"}, format="json"
    )
    assert r.status_code == 400 and "5 registros" in str(r.json())
    assert not fila and not OperacaoEmLote.objects.exists()


def test_ids_marcados_nunca_viram_operacao(cliente, gestor_municipal, tipo_queda, fila):
    marcadas = [ocorrencia(gestor_municipal, tipo_queda) for _ in range(3)]
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo", {"ids": ids(*marcadas), "prazo": "2026-12-15"}, format="json"
    )
    assert r.status_code == 200 and r.json()["atualizadas"] == 3 and not fila


def test_escopo_vale_na_execucao_em_segundo_plano(
    cliente, tecnico_a, gestor_municipal, tipo_queda, fila, limite_baixo
):
    from .conftest import PONTO_B

    for _ in range(3):
        ocorrencia(gestor_municipal, tipo_queda)
    fora = ocorrencia(gestor_municipal, tipo_queda, ponto=PONTO_B)
    cliente.como(tecnico_a).post(
        f"{OCORRENCIAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-15"}, format="json"
    )
    executar_operacao_em_lote(fila[0])
    assert OperacaoEmLote.objects.get().atualizadas == 3
    fora.refresh_from_db()
    assert fora.prazo is None


def test_tarefas_em_segundo_plano(cliente, coordenador, fila, limite_baixo):  # noqa: F811
    for _ in range(3):
        tarefa(coordenador)
    r = cliente.como(coordenador).post(
        f"{TAREFAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-20"}, format="json"
    )
    assert r.status_code == 202
    executar_operacao_em_lote(fila[0])
    assert Tarefa.objects.filter(prazo=date(2026, 12, 20)).count() == 3


# --- Alertas: status em lote -------------------------------------------------------


def test_alertas_status_em_lote_respeita_as_transicoes(cliente, analista):
    ok = alerta(1)  # detectado -> em_triagem
    em_triagem = alerta(2, status=StatusAlerta.EM_TRIAGEM)  # em_triagem -> em_triagem: não
    r = cliente.como(analista).post(
        f"{ALERTAS}/lote/status",
        {"ids": ids(ok, em_triagem), "status": "em_triagem"},
        format="json",
    )
    assert r.status_code == 200, r.json()
    corpo = r.json()
    assert corpo["atualizadas"] == 1
    assert corpo["ignoradas"][0]["codigo"] == em_triagem.codigo
    assert "Não pode passar" in corpo["ignoradas"][0]["motivo"]
    ok.refresh_from_db()
    assert ok.status == "em_triagem" and ok.analisado_por == analista


def test_alertas_encerrados_nao_mudam_e_salto_e_ignorado(cliente, analista):
    descartado = alerta(1, status=StatusAlerta.DESCARTADO)
    detectado = alerta(2)
    r = cliente.como(analista).post(
        f"{ALERTAS}/lote/status",
        {"ids": ids(descartado, detectado), "status": "descartado", "justificativa": "Queima"},
        format="json",
    )
    assert r.status_code == 200
    motivos = {i["codigo"]: i["motivo"] for i in r.json()["ignoradas"]}
    assert motivos[descartado.codigo] == "Já foi encerrada."
    assert "Não pode passar" in motivos[detectado.codigo]  # detectado não vai direto a descartado
    assert r.json()["atualizadas"] == 0


def test_alertas_status_exige_justificativa_e_referencia(cliente, analista):
    a = alerta(1, status=StatusAlerta.EM_TRIAGEM)
    cliente.como(analista)
    assert (
        cliente.post(
            f"{ALERTAS}/lote/status", {"ids": ids(a), "status": "descartado"}, format="json"
        ).status_code
        == 400
    )
    sem_ref = {"ids": ids(a), "status": "encaminhado", "justificativa": "Indício"}
    assert cliente.post(f"{ALERTAS}/lote/status", sem_ref, format="json").status_code == 400
    r = cliente.post(
        f"{ALERTAS}/lote/status", {**sem_ref, "referencia": "Protocolo 123"}, format="json"
    )
    assert r.status_code == 200 and r.json()["atualizadas"] == 1
    a.refresh_from_db()
    assert a.status == "encaminhado" and a.referencia == "Protocolo 123"


def test_alertas_status_em_lote_exige_permissao_de_triagem(cliente, territorios):
    consulta = com_escopo(
        criar_usuario("consulta@itree.teste", ["consulta"]), territorios["municipio"]
    )
    a = alerta(1)
    r = cliente.como(consulta).post(
        f"{ALERTAS}/lote/status", {"ids": ids(a), "status": "em_triagem"}, format="json"
    )
    assert r.status_code == 403


def test_alertas_todos_os_filtrados_acima_do_limite_rodam_em_segundo_plano(
    cliente, analista, fila, limite_baixo
):
    for n in range(3):
        alerta(n)
    alerta(9, status=StatusAlerta.CONFIRMADO)  # final: fora do padrão "abertos"
    r = cliente.como(analista).post(
        f"{ALERTAS}/lote/status", {"filtros": {}, "status": "em_triagem"}, format="json"
    )
    assert r.status_code == 202 and r.json()["total"] == 3
    executar_operacao_em_lote(fila[0])
    assert AlertaAmbiental.objects.filter(status="em_triagem").count() == 3


@pytest.mark.parametrize("revogacao", ["desativado", "perdeu_papel"])
def test_acesso_revogado_no_meio_encerra_a_operacao_sem_alterar_mais(
    cliente, gestor_municipal, tipo_queda, fila, limite_baixo, monkeypatch, revogacao
):
    """Antes de cada bloco o acesso é relido: quem foi desativado ou perdeu a permissão para."""
    monkeypatch.setattr(lote, "TAMANHO_BLOCO", 2)
    for _ in range(5):
        ocorrencia(gestor_municipal, tipo_queda)
    cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-15"}, format="json"
    )
    original = lote.aplicar_a_ids

    def aplicar_e_revogar(*args, **kwargs):
        resultado = original(*args, **kwargs)  # o primeiro bloco ainda é permitido
        if revogacao == "desativado":
            Usuario.objects.filter(pk=gestor_municipal.pk).update(is_active=False)
        else:
            Usuario.objects.filter(pk=gestor_municipal.pk).update(papeis=["consulta"])
        return resultado

    monkeypatch.setattr(lote, "aplicar_a_ids", aplicar_e_revogar)
    executar_operacao_em_lote(fila[0])
    op = OperacaoEmLote.objects.get()
    assert op.estado == EstadoOperacao.FALHOU
    assert "acesso revogado" in op.erro.lower() and op.concluida_em
    assert (op.processados, op.atualizadas) == (2, 2)
    assert Ocorrencia.objects.filter(prazo=date(2026, 12, 15)).count() == 2
    assert Ocorrencia.objects.filter(prazo__isnull=True).count() == 3


def test_usuario_desativado_antes_de_comecar_nao_altera_nada(
    cliente, gestor_municipal, tipo_queda, fila, limite_baixo
):
    for _ in range(3):
        ocorrencia(gestor_municipal, tipo_queda)
    cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prazo", {"filtros": {}, "prazo": "2026-12-15"}, format="json"
    )
    Usuario.objects.filter(pk=gestor_municipal.pk).update(is_active=False)
    executar_operacao_em_lote(fila[0])
    op = OperacaoEmLote.objects.get()
    assert op.estado == EstadoOperacao.FALHOU and op.processados == 0
    assert not Ocorrencia.objects.filter(prazo__isnull=False).exists()
