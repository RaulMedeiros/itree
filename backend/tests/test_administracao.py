import pytest

from itree.contas.models import Usuario

from .auditoria_util import eventos_de
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

    eventos = eventos_de(
        cliente.get(
            "/api/v1/admin/auditoria", {"objeto": str(alvo.id), "entidade": "contas.UsuarioEvent"}
        ).json()
    )
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

    eventos = eventos_de(
        cliente.get("/api/v1/admin/auditoria", {"entidade": "contas.MembroEquipeEvent"}).json()
    )
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


def test_auditoria_identifica_e_busca_o_registro_por_codigo(cliente, admin, tecnico_a, tipo_queda):
    from .conftest import PONTO_A

    criada = (
        cliente.como(tecnico_a)
        .post(
            "/api/v1/ocorrencias",
            {"tipo_id": str(tipo_queda.id), "localizacao": PONTO_A, "descricao": "Galho caído"},
            format="json",
        )
        .json()
    )
    outra = cliente.post(
        "/api/v1/ocorrencias",
        {"tipo_id": str(tipo_queda.id), "localizacao": PONTO_A, "descricao": "Outro galho"},
        format="json",
    ).json()
    assert criada["codigo"] != outra["codigo"]

    # Aceita minúsculas e zeros à esquerda omitidos.
    numero = int(criada["codigo"].split("-")[1])
    eventos = cliente.como(admin).get("/api/v1/admin/auditoria", {"codigo": f"oco-{numero}"}).json()
    assert eventos["count"] >= 1
    assert {e["registro"] for e in eventos_de(eventos)} == {criada["codigo"]}

    assert cliente.get("/api/v1/admin/auditoria", {"codigo": "XYZ-1"}).json()["count"] == 0
    assert cliente.get("/api/v1/admin/auditoria", {"codigo": "lixo"}).json()["count"] == 0


def test_auditoria_mostra_e_busca_pelo_registro_pai(cliente, admin, tecnico_a):
    from django.utils import timezone

    from itree.evidencias.models import Evidencia
    from itree.inspecoes.models import Inspecao
    from itree.inventario.models import Arvore, Medida
    from itree.qualidade.models import InferenciaIA

    arvore = Arvore.objects.create(origem_registro="importacao", especie_texto_original="Oity")
    outra = Arvore.objects.create(origem_registro="importacao", especie_texto_original="Ipê")
    inspecao = Inspecao.objects.create(
        arvore=arvore, tecnico=tecnico_a, realizada_em=timezone.now()
    )
    Medida.objects.create(
        arvore=arvore, tipo="altura", valor=8, unidade="m", metodo="trena", origem="medido"
    )
    Medida.objects.create(
        arvore=outra, tipo="altura", valor=5, unidade="m", metodo="trena", origem="medido"
    )
    Medida.objects.create(
        arvore=arvore,
        inspecao=inspecao,
        tipo="dap",
        valor=30,
        unidade="cm",
        metodo="fita_diametrica",
        origem="medido",
    )
    Evidencia.objects.create(
        chave="a/1.jpg",
        nome_original="1.jpg",
        tipo_conteudo="image/jpeg",
        tamanho=10,
        enviada_por=tecnico_a,
        inspecao=inspecao,
        arvore=arvore,
    )
    InferenciaIA.objects.create(
        tarefa="especie",
        arvore=arvore,
        modelo="m",
        versao_modelo="1",
        resultado={},
        registrada_por=tecnico_a,
    )

    def pais(codigo):
        corpo = cliente.como(admin).get("/api/v1/admin/auditoria", {"codigo": codigo}).json()
        return sorted(
            (e["entidade"], e["pai"]["codigo"], e["pai"]["tipo"], e["pai"]["id"])
            for e in eventos_de(corpo)
            if e["pai"]
        )

    # Medida e sugestão sem inspeção apontam para a árvore.
    assert pais(arvore.codigo) == [
        ("Medida", arvore.codigo, "arvore", str(arvore.pk)),
        ("Sugestão de IA", arvore.codigo, "arvore", str(arvore.pk)),
    ]
    # Medida e evidência de uma inspeção apontam para a inspeção.
    assert pais(inspecao.codigo) == [
        ("Evidência", inspecao.codigo, "inspecao", str(inspecao.pk)),
        ("Medida", inspecao.codigo, "inspecao", str(inspecao.pk)),
    ]
    # O próprio registro continua sendo achado, sem pai.
    achados = eventos_de(cliente.get("/api/v1/admin/auditoria", {"codigo": arvore.codigo}).json())
    assert {e["entidade"] for e in achados} == {"Árvore", "Medida", "Sugestão de IA"}
    # A listagem sem filtro também identifica o pai.
    todos = cliente.get("/api/v1/admin/auditoria", {"entidade": "inventario.MedidaEvent"}).json()
    assert {e["pai"]["codigo"] for e in eventos_de(todos)} == {
        arvore.codigo,
        outra.codigo,
        inspecao.codigo,
    }


def _medidas(arvore, quantidade, **extra):
    from itree.inventario.models import Medida

    for i in range(quantidade):
        Medida.objects.create(
            arvore=arvore,
            tipo="altura",
            valor=i + 1,
            unidade="m",
            metodo="trena",
            origem="medido",
            **extra,
        )


def _arvores(n):
    from itree.inventario.models import Arvore

    return [
        Arvore.objects.create(origem_registro="importacao", especie_texto_original=f"Oity {i}")
        for i in range(n)
    ]


def test_auditoria_agrupa_no_servidor_eventos_iguais(cliente, admin):
    a, b = _arvores(2)
    _medidas(a, 4)
    _medidas(b, 3)
    corpo = (
        cliente.como(admin)
        .get("/api/v1/admin/auditoria", {"entidade": "inventario.MedidaEvent"})
        .json()
    )
    # Mesma entidade, ação, autor, origem e minuto, mas pais diferentes: dois grupos.
    assert corpo["count"] == 2
    assert sorted(g["quantidade"] for g in corpo["results"]) == [3, 4]
    for grupo in corpo["results"]:
        assert len(grupo["eventos"]) == grupo["quantidade"] and not grupo["truncado"]
        assert len({e["pai"]["id"] for e in grupo["eventos"]}) == 1
        assert grupo["id"] == grupo["eventos"][0]["id"]


def test_auditoria_nao_junta_autor_origem_acao_nem_minuto_diferentes(cliente, admin):
    import pghistory
    import pgtrigger
    from django.utils import timezone

    from itree.inventario.models import Medida, MedidaEvent

    (a,) = _arvores(1)
    with pghistory.context(user=str(admin.id), origem="web"):
        _medidas(a, 2)  # será envelhecido: mesmo grupo, mas outro minuto
    with pgtrigger.ignore():  # a trilha é só de inserção; o teste recua o relógio de dois eventos
        MedidaEvent.objects.update(pgh_created_at=timezone.now() - timezone.timedelta(hours=1))
    with pghistory.context(user=str(admin.id), origem="web"):
        _medidas(a, 2)
    with pghistory.context(user=str(admin.id), origem="app"):
        _medidas(a, 2)  # outra origem
    with pghistory.context(origem="web"):
        _medidas(a, 2)  # sem autor
    Medida.objects.filter(arvore=a).first().delete()  # outra ação

    corpo = (
        cliente.como(admin)
        .get("/api/v1/admin/auditoria", {"entidade": "inventario.MedidaEvent"})
        .json()
    )
    assert corpo["count"] == 5
    assert sorted(g["quantidade"] for g in corpo["results"]) == [1, 2, 2, 2, 2]
    assert [g["eventos"][0]["acao"] for g in corpo["results"]].count("exclusao") == 1
    # Do mais recente ao mais antigo: o grupo envelhecido é o último.
    assert (
        corpo["results"][-1]["eventos"][0]["momento"] < corpo["results"][0]["eventos"][0]["momento"]
    )


def test_auditoria_pagina_por_grupo_sem_partir_nenhum(cliente, admin):
    arvores = _arvores(5)
    for i, arvore in enumerate(arvores):
        _medidas(arvore, i + 1)  # grupos de 1, 2, 3, 4 e 5 eventos
    cliente.como(admin)
    paginas = [
        cliente.get(
            "/api/v1/admin/auditoria",
            {"entidade": "inventario.MedidaEvent", "tamanho": 2, "pagina": n},
        ).json()
        for n in (1, 2, 3)
    ]
    assert [p["count"] for p in paginas] == [5, 5, 5]
    assert [len(p["results"]) for p in paginas] == [2, 2, 1]
    vistos = [e["id"] for p in paginas for e in eventos_de(p)]
    assert len(vistos) == len(set(vistos)) == 15  # nenhum evento repetido ou perdido
    # Cada pai aparece em um único grupo, em uma única página.
    pais = [(n, g["eventos"][0]["pai"]["id"]) for n, p in enumerate(paginas) for g in p["results"]]
    assert len({pai for _, pai in pais}) == 5


def test_auditoria_limita_os_eventos_de_um_grupo_grande(cliente, admin, monkeypatch):
    from itree.auditoria import views

    monkeypatch.setattr(views, "LIMITE_EVENTOS_POR_GRUPO", 3)
    (a,) = _arvores(1)
    _medidas(a, 5)
    corpo = (
        cliente.como(admin)
        .get("/api/v1/admin/auditoria", {"entidade": "inventario.MedidaEvent"})
        .json()
    )
    (grupo,) = corpo["results"]
    assert grupo["quantidade"] == 5 and grupo["truncado"] is True
    assert [e["dados"]["valor"] for e in grupo["eventos"]] == [5, 4, 3]  # os mais recentes
