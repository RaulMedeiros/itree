"""Preferências de notificação e e-mail (M-14)."""

import pytest
from django.core import mail

from itree.contas.models import Equipe, MembroEquipe
from itree.notificacoes import tasks
from itree.notificacoes.models import Notificacao, TipoNotificacao

from .conftest import PONTO_A, com_escopo, criar_usuario

pytestmark = pytest.mark.django_db

URL = "/api/v1/notificacoes/preferencias"


@pytest.fixture
def executar(django_capture_on_commit_callbacks):
    return lambda: django_capture_on_commit_callbacks(execute=True)


@pytest.fixture
def enfileiradas(monkeypatch):
    """Capta os envios de e-mail em vez de chamar o Celery."""
    ids: list[str] = []
    monkeypatch.setattr(tasks.enviar_email_notificacao, "delay", lambda i: ids.append(i))
    return ids


@pytest.fixture
def coordenador(territorios):
    return com_escopo(criar_usuario("coord@itree.teste", ["coordenador"]), territorios["municipio"])


@pytest.fixture
def arvore_a(cliente, revisor):
    return (
        cliente.como(revisor)
        .post("/api/v1/arvores", {"localizacao": PONTO_A}, format="json")
        .json()
    )


def atribuir_a_equipe(cliente, coordenador, tecnico, arvore):
    equipe = Equipe.objects.create(nome="Poda A")
    MembroEquipe.objects.create(equipe=equipe, usuario=tecnico)
    corpo = {"tipo": "inspecao_arvore", "arvore_id": arvore["id"], "equipe_id": str(equipe.id)}
    r = cliente.como(coordenador).post("/api/v1/tarefas", corpo, format="json")
    assert r.status_code == 201, r.json()


def definir(cliente, usuario, **por_tipo):
    corpo = {"preferencias": [{"tipo": t, **v} for t, v in por_tipo.items()]}
    return cliente.como(usuario).put(URL, corpo, format="json")


def test_sem_escolha_vale_o_padrao_sino_sim_email_nao(cliente, tecnico_a):
    r = cliente.como(tecnico_a).get(URL)
    assert r.status_code == 200
    linhas = r.json()
    assert [p["tipo"] for p in linhas] == list(TipoNotificacao.values)
    assert all(p["ativa"] is True and p["email"] is False for p in linhas)
    assert all(p["rotulo"] for p in linhas)


def test_salvar_muda_so_os_tipos_enviados_e_so_do_proprio_usuario(cliente, tecnico_a, revisor):
    r = definir(
        cliente,
        tecnico_a,
        tarefa_atribuida={"ativa": True, "email": True},
        alerta_novo={"ativa": False, "email": False},
    )
    assert r.status_code == 200, r.json()
    por_tipo = {p["tipo"]: p for p in r.json()}
    assert por_tipo["tarefa_atribuida"]["email"] is True
    assert por_tipo["alerta_novo"]["ativa"] is False
    assert por_tipo["risco_confirmado"]["ativa"] is True  # não enviado, segue o padrão
    # Outra pessoa continua no padrão.
    outro = {p["tipo"]: p for p in cliente.como(revisor).get(URL).json()}
    assert outro["tarefa_atribuida"]["email"] is False
    assert outro["alerta_novo"]["ativa"] is True


def test_tipo_silenciado_nao_recebe_email(cliente, tecnico_a):
    r = definir(cliente, tecnico_a, alerta_novo={"ativa": False, "email": True})
    assert {p["tipo"]: p for p in r.json()}["alerta_novo"]["email"] is False


def test_tipo_desconhecido_ou_repetido_e_recusado(cliente, tecnico_a):
    r = definir(cliente, tecnico_a, inexistente={"ativa": True, "email": False})
    assert r.status_code == 400
    corpo = {
        "preferencias": [
            {"tipo": "alerta_novo", "ativa": True, "email": False},
            {"tipo": "alerta_novo", "ativa": False, "email": False},
        ]
    }
    assert cliente.put(URL, corpo, format="json").status_code == 400


def test_exige_autenticacao(cliente):
    assert cliente.get(URL).status_code in (401, 403)


def test_tipo_silenciado_nao_gera_notificacao(
    cliente, executar, coordenador, tecnico_a, arvore_a, enfileiradas
):
    definir(cliente, tecnico_a, tarefa_atribuida={"ativa": False, "email": False})
    with executar():
        atribuir_a_equipe(cliente, coordenador, tecnico_a, arvore_a)
    assert not Notificacao.objects.filter(usuario=tecnico_a).exists()
    assert enfileiradas == []


def test_por_padrao_notifica_no_sino_e_nao_envia_email(
    cliente, executar, coordenador, tecnico_a, arvore_a, enfileiradas
):
    with executar():
        atribuir_a_equipe(cliente, coordenador, tecnico_a, arvore_a)
    assert Notificacao.objects.filter(usuario=tecnico_a, tipo="tarefa_atribuida").count() == 1
    assert enfileiradas == []


def test_com_email_ligado_enfileira_o_envio_da_notificacao(
    cliente, executar, coordenador, tecnico_a, arvore_a, enfileiradas
):
    definir(cliente, tecnico_a, tarefa_atribuida={"ativa": True, "email": True})
    with executar():
        atribuir_a_equipe(cliente, coordenador, tecnico_a, arvore_a)
    n = Notificacao.objects.get(usuario=tecnico_a)
    assert enfileiradas == [str(n.pk)]


def test_tarefa_envia_o_email_uma_unica_vez(tecnico_a, settings):
    settings.WEB_URL_PUBLICA = "https://itree.teste"
    n = Notificacao.objects.create(
        usuario=tecnico_a,
        tipo="tarefa_atribuida",
        titulo="Tarefa TAR-1 atribuída",
        texto="Vistoriar",
        link="/equipes-tarefas?responsavel=eu",
    )
    assert tasks.enviar_email_notificacao(str(n.pk)) is True
    assert len(mail.outbox) == 1
    msg = mail.outbox[0]
    assert msg.to == [tecnico_a.email]
    assert "Tarefa TAR-1 atribuída" in msg.subject
    assert "https://itree.teste/equipes-tarefas?responsavel=eu" in msg.body
    n.refresh_from_db()
    assert n.email_enviado_em is not None
    # Reexecutar (retentativa do Celery) não duplica.
    assert tasks.enviar_email_notificacao(str(n.pk)) is False
    assert len(mail.outbox) == 1


def test_falha_de_smtp_nao_marca_como_enviado(tecnico_a, monkeypatch):
    n = Notificacao.objects.create(usuario=tecnico_a, tipo="alerta_novo", titulo="Novo alerta")

    def falha(*a, **k):
        raise OSError("smtp fora do ar")

    monkeypatch.setattr(tasks, "send_mail", falha)
    with pytest.raises(Exception):  # noqa: B017 - o retry do Celery relança
        tasks.enviar_email_notificacao.apply(args=[str(n.pk)], throw=True)
    n.refresh_from_db()
    assert n.email_enviado_em is None
