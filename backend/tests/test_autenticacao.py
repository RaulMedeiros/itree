import pytest

from itree.contas.models import Usuario

from .conftest import OUTRA_CHAVE, criar_usuario, emitir_token

pytestmark = pytest.mark.django_db


def _get(cliente, token):
    return cliente.get("/api/v1/eu", HTTP_AUTHORIZATION=f"Bearer {token}")


def test_sem_token_e_401(cliente):
    assert cliente.get("/api/v1/eu").status_code == 401


def test_assinatura_invalida(cliente):
    assert _get(cliente, emitir_token(chave=OUTRA_CHAVE, email="a@b.c")).status_code == 401


def test_audiencia_errada(cliente):
    assert _get(cliente, emitir_token(aud="outra", email="a@b.c")).status_code == 401


def test_emissor_errado(cliente):
    assert _get(cliente, emitir_token(iss="https://mal.teste", email="a@b.c")).status_code == 401


def test_primeiro_acesso_cria_usuario_sem_papeis(cliente):
    resposta = _get(cliente, emitir_token(sub="sub-1", email="Nova@Itree.Teste", name="Nova"))
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["email"] == "nova@itree.teste"
    assert corpo["papeis"] == []
    assert corpo["permissoes"] == []
    assert Usuario.objects.get(oidc_sub="sub-1").nome == "Nova"


def test_vincula_usuario_pre_cadastrado_pelo_email(cliente):
    usuario = criar_usuario("tecnica@itree.teste", ["tecnico"])
    resposta = _get(cliente, emitir_token(sub="sub-2", email="tecnica@itree.teste"))
    assert resposta.status_code == 200
    assert resposta.json()["id"] == str(usuario.id)
    usuario.refresh_from_db()
    assert usuario.oidc_sub == "sub-2"
    assert "inventario.editar" in resposta.json()["permissoes"]


def test_email_nao_verificado_e_recusado(cliente):
    criar_usuario("x@itree.teste", ["administrador"])
    token = emitir_token(sub="sub-3", email="x@itree.teste", email_verified=False)
    assert _get(cliente, token).status_code == 401


def test_email_ja_vinculado_a_outra_identidade(cliente):
    criar_usuario("y@itree.teste", oidc_sub="sub-original")
    assert _get(cliente, emitir_token(sub="sub-novo", email="y@itree.teste")).status_code == 401


def test_usuario_desativado_perde_acesso_imediatamente(cliente):
    usuario = criar_usuario("z@itree.teste", ["gestor"], oidc_sub="sub-z")
    token = emitir_token(sub="sub-z", email="z@itree.teste")
    assert _get(cliente, token).status_code == 200
    usuario.is_active = False
    usuario.save()
    assert _get(cliente, token).status_code == 401


def test_ultimo_acesso_registrado_sem_gerar_evento_de_auditoria(cliente):
    from pghistory.models import Events

    usuario = criar_usuario("w@itree.teste", ["gestor"], oidc_sub="sub-w")
    antes = Events.objects.tracks(usuario).count()
    assert _get(cliente, emitir_token(sub="sub-w", email="w@itree.teste")).status_code == 200
    usuario.refresh_from_db()
    assert usuario.last_login is not None
    assert Events.objects.tracks(usuario).count() == antes
