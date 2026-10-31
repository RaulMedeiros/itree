import pytest

from itree.contas.models import Usuario

from .conftest import criar_territorio, criar_usuario

pytestmark = pytest.mark.django_db


def test_sem_permissao_nao_acessa_administracao(cliente, gestor):
    cliente.como(gestor)
    assert cliente.get("/api/v1/admin/usuarios").status_code == 403
    assert cliente.get("/api/v1/admin/auditoria").status_code == 403
    assert cliente.post("/api/v1/equipes", {"nome": "X"}, format="json").status_code == 403


def test_admin_pre_cadastra_usuario(cliente, admin):
    bairro = criar_territorio("Benfica")
    resposta = cliente.como(admin).post(
        "/api/v1/admin/usuarios",
        {
            "email": "Nova@Itree.Teste",
            "nome": "Nova",
            "papeis": ["revisor", "revisor"],
            "territorio_ids": [str(bairro.id)],
        },
        format="json",
    )
    assert resposta.status_code == 201, resposta.json()
    corpo = resposta.json()
    assert corpo["email"] == "nova@itree.teste"
    assert corpo["papeis"] == ["revisor"]
    assert corpo["vinculado"] is False
    assert [t["nome"] for t in corpo["territorios"]] == ["Benfica"]
    assert not Usuario.objects.get(email="nova@itree.teste").has_usable_password()


def test_papel_invalido_e_rejeitado(cliente, admin):
    resposta = cliente.como(admin).post(
        "/api/v1/admin/usuarios", {"email": "a@b.c", "papeis": ["superusuario"]}, format="json"
    )
    assert resposta.status_code == 400


def test_alteracao_de_papel_fica_na_auditoria_com_motivo(cliente, admin):
    alvo = criar_usuario("alvo@itree.teste", ["consulta"])
    cliente.como(admin)
    resposta = cliente.patch(
        f"/api/v1/admin/usuarios/{alvo.id}",
        {"papeis": ["gestor"], "motivo": "Nomeação 12/2026"},
        format="json",
    )
    assert resposta.status_code == 200

    eventos = cliente.get(
        "/api/v1/admin/auditoria", {"objeto": str(alvo.id), "entidade": "contas.UsuarioEvent"}
    ).json()["results"]
    alteracao = next(e for e in eventos if e["acao"] == "alteracao")
    assert alteracao["diferencas"]["papeis"] == [["consulta"], ["gestor"]]
    assert alteracao["contexto"]["user"] == str(admin.id)
    assert alteracao["contexto"]["origem"] == "web"
    assert alteracao["contexto"]["motivo"] == "Nomeação 12/2026"
    assert "password" not in alteracao["dados"]


def test_admin_nao_desativa_a_si_mesmo(cliente, admin):
    resposta = cliente.como(admin).patch(
        f"/api/v1/admin/usuarios/{admin.id}", {"ativo": False}, format="json"
    )
    assert resposta.status_code == 400


def test_admin_nao_remove_proprio_papel_de_administrador(cliente, admin):
    resposta = cliente.como(admin).patch(
        f"/api/v1/admin/usuarios/{admin.id}", {"papeis": ["gestor"]}, format="json"
    )
    assert resposta.status_code == 400


def test_desativar_usuario_remove_permissoes(cliente, admin):
    alvo = criar_usuario("sai@itree.teste", ["gestor"])
    cliente.como(admin).patch(f"/api/v1/admin/usuarios/{alvo.id}", {"ativo": False}, format="json")
    alvo.refresh_from_db()
    assert alvo.permissoes == frozenset()


def test_filtros_da_lista_de_usuarios(cliente, admin):
    criar_usuario("maria@itree.teste", ["tecnico"])
    criar_usuario("joao@itree.teste", ["gestor"], is_active=False)
    cliente.como(admin)
    emails = lambda r: {u["email"] for u in r.json()["results"]}  # noqa: E731
    assert emails(cliente.get("/api/v1/admin/usuarios", {"busca": "mar"})) == {"maria@itree.teste"}
    assert emails(cliente.get("/api/v1/admin/usuarios", {"papel": "gestor"})) == {
        "joao@itree.teste"
    }
    assert "joao@itree.teste" not in emails(
        cliente.get("/api/v1/admin/usuarios", {"ativo": "true"})
    )


def test_equipe_com_membros_e_territorios_auditados(cliente, admin):
    tecnica = criar_usuario("tec@itree.teste", ["tecnico"])
    bairro = criar_territorio("Aldeota")
    cliente.como(admin)
    resposta = cliente.post(
        "/api/v1/equipes",
        {
            "nome": "Regional II",
            "coordenador_id": str(admin.id),
            "membro_ids": [str(tecnica.id)],
            "territorio_ids": [str(bairro.id)],
        },
        format="json",
    )
    assert resposta.status_code == 201, resposta.json()
    equipe_id = resposta.json()["id"]

    resposta = cliente.patch(f"/api/v1/equipes/{equipe_id}", {"membro_ids": []}, format="json")
    assert resposta.json()["membros"] == []

    eventos = cliente.get(
        "/api/v1/admin/auditoria", {"entidade": "contas.MembroEquipeEvent"}
    ).json()["results"]
    assert [e["acao"] for e in eventos] == ["exclusao", "criacao"]


def test_leitura_de_equipes_exige_tarefas_ler(cliente, gestor):
    assert cliente.como(gestor).get("/api/v1/equipes").status_code == 200
    sem_papel = criar_usuario("nada@itree.teste")
    assert cliente.como(sem_papel).get("/api/v1/equipes").status_code == 403


def test_auditoria_rejeita_data_invalida(cliente, admin):
    resposta = cliente.como(admin).get("/api/v1/admin/auditoria", {"desde": "ontem"})
    assert resposta.status_code == 400


def test_comando_criar_administrador_e_idempotente():
    from django.core.management import call_command

    criar_territorio("Fortaleza", tipo="municipio")
    call_command("criar_administrador", email="Chefe@Itree.Teste", territorio=["fortaleza"])
    call_command("criar_administrador", email="chefe@itree.teste", territorio=["Fortaleza"])
    usuario = Usuario.objects.get(email="chefe@itree.teste")
    assert usuario.papeis == ["administrador"]
    assert [t.nome for t in usuario.territorios.all()] == ["Fortaleza"]
    assert not usuario.has_usable_password()
