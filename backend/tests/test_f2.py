"""F2: inspeções (sincronização e revisão), tarefas e painel de indicadores."""

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from itree.inventario.models import Arvore, Especie, Medida
from itree.tarefas.models import Tarefa

from .conftest import PONTO_A, PONTO_B, com_escopo, criar_usuario

pytestmark = pytest.mark.django_db

SYNC = "/api/v1/inspecoes/sincronizar"


@pytest.fixture
def arvore_a(cliente, revisor):
    return (
        cliente.como(revisor)
        .post("/api/v1/arvores", {"localizacao": PONTO_A}, format="json")
        .json()
    )


@pytest.fixture
def ipe(db):
    return Especie.objects.create(nome_cientifico="Handroanthus impetiginosus")


def inspecao(arvore_id, **extras):
    return {
        "id": str(uuid.uuid4()),
        "arvore": arvore_id,
        "realizada_em": (timezone.now() - timedelta(hours=1)).isoformat(),
        "localizacao": {"longitude": -38.55501, "latitude": -3.75502},
        "precisao_m": 4.5,
        "condicao_aparente": "regular",
        "sinais": ["galhos_secos", "ferida"],
        "medidas": [{"tipo": "altura", "valor": "9.2", "metodo": "hipsometro", "origem": "medido"}],
        **extras,
    }


def sincronizar(cliente, usuario, *itens):
    return cliente.como(usuario).post(
        SYNC, {"dispositivo": "android-teste", "inspecoes": list(itens)}, format="json"
    )


# --- Sincronização -------------------------------------------------------------


def test_sincronizacao_idempotente(cliente, tecnico_a, arvore_a):
    item = inspecao(arvore_a["id"])
    r = sincronizar(cliente, tecnico_a, item)
    assert r.status_code == 200, r.json()
    assert r.json()[0] | {"id": None} == {
        "id": None,
        "status": "criada",
        "versao": 1,
        "estado": "rascunho",
        "mensagem": "",
        "erros": {},
    }
    # Reenvio (perda de conexão antes da confirmação) não duplica.
    r = sincronizar(cliente, tecnico_a, item)
    assert r.json()[0]["status"] == "ja_recebida"
    assert cliente.get("/api/v1/inspecoes").json()["count"] == 1
    # Medidas de inspeção não entram no cadastro antes da validação.
    assert Medida.objects.get().aplicada is False
    assert cliente.get(f"/api/v1/arvores/{arvore_a['id']}").json()["medidas_atuais"] == []


def test_atualizacao_com_versao_e_conflito(cliente, tecnico_a, arvore_a):
    item = inspecao(arvore_a["id"])
    sincronizar(cliente, tecnico_a, item)
    r = sincronizar(cliente, tecnico_a, {**item, "versao_base": 1, "observacoes": "Revisto"})
    assert (r.json()[0]["status"], r.json()[0]["versao"]) == ("atualizada", 2)
    # Dispositivo com versão desatualizada: conflito explícito.
    r = sincronizar(cliente, tecnico_a, {**item, "versao_base": 1, "observacoes": "Outra"})
    assert r.json()[0]["status"] == "conflito"


def test_item_invalido_nao_derruba_o_lote(cliente, tecnico_a, arvore_a):
    ok = inspecao(arvore_a["id"])
    ruim = inspecao(arvore_a["id"], condicao_aparente="excelente")
    resultados = sincronizar(cliente, tecnico_a, ok, ruim).json()
    assert [r["status"] for r in resultados] == ["criada", "erro"]
    assert "condicao_aparente" in resultados[1]["erros"]


def test_estimativa_visual_como_medida_e_recusada(cliente, tecnico_a, arvore_a):
    item = inspecao(
        arvore_a["id"],
        medidas=[{"tipo": "altura", "valor": "9", "metodo": "visual", "origem": "medido"}],
    )
    assert sincronizar(cliente, tecnico_a, item).json()[0]["status"] == "erro"


def test_arvore_fora_do_escopo(cliente, tecnico_a, revisor):
    outra = (
        cliente.como(revisor)
        .post("/api/v1/arvores", {"localizacao": PONTO_B}, format="json")
        .json()
    )
    assert sincronizar(cliente, tecnico_a, inspecao(outra["id"])).json()[0]["status"] == "erro"


def test_consulta_nao_sincroniza(cliente, territorios, arvore_a):
    leitor = com_escopo(criar_usuario("c@itree.teste", ["consulta"]), territorios["municipio"])
    assert sincronizar(cliente, leitor, inspecao(arvore_a["id"])).status_code == 403


# --- Revisão -------------------------------------------------------------------


def enviada(cliente, tecnico, arvore_id, **extras):
    item = inspecao(arvore_id, enviar_para_revisao=True, **extras)
    assert sincronizar(cliente, tecnico, item).json()[0]["estado"] == "em_revisao"
    return item["id"]


def test_validar_aplica_somente_o_escolhido(cliente, tecnico_a, revisor, arvore_a, ipe):
    ins = enviada(cliente, tecnico_a, arvore_a["id"], especie=str(ipe.id))
    r = cliente.como(revisor).post(
        f"/api/v1/inspecoes/{ins}/validar",
        {"aplicar": ["condicao_aparente", "medidas"]},
        format="json",
    )
    assert r.status_code == 200, r.json()
    assert r.json()["estado"] == "validada"
    assert r.json()["aplicado_ao_cadastro"] == ["condicao_aparente", "medidas"]
    arvore = Arvore.objects.get(pk=arvore_a["id"])
    assert arvore.condicao_aparente == "regular"
    assert arvore.ultima_inspecao_em is not None
    assert arvore.especie_id is None  # espécie não foi escolhida
    assert arvore.localizacao_origem == "estimada_web"  # localização não foi escolhida
    assert Medida.objects.get().aplicada is True
    # Validada não é editável pelo dispositivo.
    item = {**inspecao(arvore_a["id"]), "id": ins, "versao_base": 2}
    assert sincronizar(cliente, tecnico_a, item).json()[0]["status"] == "conflito"


def test_validar_localizacao_e_especie(cliente, tecnico_a, revisor, arvore_a, ipe):
    ins = enviada(cliente, tecnico_a, arvore_a["id"], especie=str(ipe.id))
    cliente.como(revisor).post(
        f"/api/v1/inspecoes/{ins}/validar", {"aplicar": ["especie", "localizacao"]}, format="json"
    )
    arvore = Arvore.objects.get(pk=arvore_a["id"])
    assert (arvore.especie_id, arvore.especie_estado) == (ipe.id, "confirmada")
    assert arvore.localizacao_origem == "gps_campo" and arvore.precisao_m == 4.5


def test_validar_sem_selecao_nao_altera_cadastro(cliente, tecnico_a, revisor, arvore_a):
    """CA-INSP-003."""
    ins = enviada(cliente, tecnico_a, arvore_a["id"])
    cliente.como(revisor).post(f"/api/v1/inspecoes/{ins}/validar", {"aplicar": []}, format="json")
    arvore = Arvore.objects.get(pk=arvore_a["id"])
    assert arvore.condicao_aparente == "" and Medida.objects.get().aplicada is False


def test_devolver_exige_motivo_e_volta_ao_tecnico(cliente, tecnico_a, revisor, arvore_a):
    ins = enviada(cliente, tecnico_a, arvore_a["id"])
    url = f"/api/v1/inspecoes/{ins}/devolver"
    assert cliente.como(revisor).post(url, {"motivo": ""}, format="json").status_code == 400
    r = cliente.post(url, {"motivo": "Foto do tronco ilegível"}, format="json")
    assert r.json()["estado"] == "devolvida"
    versao = r.json()["versao"]
    item = {
        **inspecao(arvore_a["id"]),
        "id": ins,
        "versao_base": versao,
        "enviar_para_revisao": True,
    }
    assert sincronizar(cliente, tecnico_a, item).json()[0]["estado"] == "em_revisao"


def test_tecnico_nao_valida_e_revisor_nao_valida_a_propria(cliente, tecnico_a, revisor, arvore_a):
    ins = enviada(cliente, tecnico_a, arvore_a["id"])
    assert (
        cliente.como(tecnico_a)
        .post(f"/api/v1/inspecoes/{ins}/validar", {}, format="json")
        .status_code
        == 403
    )
    propria = enviada(cliente, revisor, arvore_a["id"])
    r = cliente.como(revisor).post(f"/api/v1/inspecoes/{propria}/validar", {}, format="json")
    assert r.status_code == 400 and "outra pessoa" in r.json()[0]


def test_detalhe_traz_inspecao_anterior(cliente, tecnico_a, arvore_a):
    primeira = inspecao(
        arvore_a["id"], realizada_em=(timezone.now() - timedelta(days=30)).isoformat()
    )
    segunda = inspecao(arvore_a["id"])
    sincronizar(cliente, tecnico_a, primeira, segunda)
    detalhe = cliente.get(f"/api/v1/inspecoes/{segunda['id']}").json()
    assert detalhe["anterior"]["id"] == primeira["id"]
    assert detalhe["medidas"][0]["tipo"] == "altura"


# --- Tarefas -------------------------------------------------------------------


@pytest.fixture
def coordenador(territorios):
    return com_escopo(criar_usuario("coord@itree.teste", ["coordenador"]), territorios["municipio"])


def test_tarefas_em_lote_pelos_filtros(cliente, coordenador, revisor, tecnico_a):
    for ponto in (PONTO_A, PONTO_A, PONTO_B):
        cliente.como(revisor).post("/api/v1/arvores", {"localizacao": ponto}, format="json")
    bairro_a = Arvore.objects.filter(bairro__nome="Bairro A").first().bairro_id
    corpo = {
        "filtros_arvores": {"bairro": str(bairro_a)},
        "responsavel_id": str(tecnico_a.id),
        "prazo": str(timezone.localdate() + timedelta(days=7)),
    }
    r = cliente.como(coordenador).post("/api/v1/tarefas/lote", corpo, format="json")
    assert r.status_code == 201, r.json()
    assert r.json() == {"criadas": 2, "ignoradas": 0, "fora_do_escopo_do_responsavel": 0}
    # Repetir não duplica tarefas abertas.
    assert cliente.post("/api/v1/tarefas/lote", corpo, format="json").json()["ignoradas"] == 2
    # Responsável fora do escopo da árvore.
    corpo["filtros_arvores"] = {"situacao": "ativa"}
    assert (
        cliente.post("/api/v1/tarefas/lote", corpo, format="json").json()[
            "fora_do_escopo_do_responsavel"
        ]
        == 1
    )
    assert (
        cliente.como(tecnico_a).get("/api/v1/tarefas", {"responsavel": "eu"}).json()["count"] == 2
    )


def test_enviar_inspecao_conclui_a_tarefa(cliente, coordenador, tecnico_a, arvore_a):
    tarefa = (
        cliente.como(coordenador)
        .post(
            "/api/v1/tarefas",
            {
                "tipo": "inspecao_arvore",
                "arvore_id": arvore_a["id"],
                "responsavel_id": str(tecnico_a.id),
            },
            format="json",
        )
        .json()
    )
    assert tarefa["estado"] == "nao_iniciada"
    enviada(cliente, tecnico_a, arvore_a["id"], tarefa=tarefa["id"])
    assert Tarefa.objects.get(pk=tarefa["id"]).estado == "concluida"


def test_transicoes_e_reatribuicao_de_tarefa(cliente, coordenador, tecnico_a, arvore_a):
    t = (
        cliente.como(coordenador)
        .post(
            "/api/v1/tarefas",
            {
                "tipo": "inspecao_arvore",
                "arvore_id": arvore_a["id"],
                "responsavel_id": str(tecnico_a.id),
            },
            format="json",
        )
        .json()
    )
    url = f"/api/v1/tarefas/{t['id']}/transicao"
    # O responsável atualiza o andamento.
    assert (
        cliente.como(tecnico_a).post(url, {"estado": "em_execucao"}, format="json").status_code
        == 200
    )
    assert (
        cliente.post(url, {"estado": "bloqueada"}, format="json").status_code == 400
    )  # sem motivo
    assert (
        cliente.post(
            url, {"estado": "bloqueada", "motivo": "Portão fechado"}, format="json"
        ).status_code
        == 200
    )
    r = cliente.como(coordenador).patch(
        f"/api/v1/tarefas/{t['id']}", {"responsavel_id": None, "motivo": "Férias"}, format="json"
    )
    assert r.json()["responsavel"] is None
    historico = cliente.get(f"/api/v1/tarefas/{t['id']}/historico").json()
    assert historico[0]["contexto"]["motivo"] == "Férias"


def test_concluir_ocorrencia_encerra_tarefa_de_atendimento(
    cliente, coordenador, gestor_municipal, tipo_queda
):
    oco = (
        cliente.como(gestor_municipal)
        .post(
            "/api/v1/ocorrencias",
            {"tipo_id": str(tipo_queda.id), "localizacao": PONTO_A, "descricao": "x"},
            format="json",
        )
        .json()
    )
    t = (
        cliente.como(coordenador)
        .post(
            "/api/v1/tarefas",
            {"tipo": "atendimento_ocorrencia", "ocorrencia_id": oco["id"]},
            format="json",
        )
        .json()
    )
    url = f"/api/v1/ocorrencias/{oco['id']}/transicao"
    for estado in ("em_triagem", "em_atendimento", "concluida"):
        cliente.como(gestor_municipal).post(url, {"estado": estado}, format="json")
    assert Tarefa.objects.get(pk=t["id"]).estado == "concluida"


# --- Painel --------------------------------------------------------------------


def test_painel_distingue_ausencia_de_zero(cliente, gestor_municipal):
    corpo = cliente.como(gestor_municipal).get("/api/v1/indicadores/painel").json()
    indicadores = {i["id"]: i for i in corpo["indicadores"]}
    assert indicadores["arvores_validas"]["valor"] == 0
    # Sem árvores válidas não há percentual (null, não 0) — RN-VG-001.
    assert indicadores["especie_confirmada"]["valor"] is None
    assert indicadores["tempo_atendimento"]["valor"] is None
    for i in corpo["indicadores"]:
        assert i["definicao"] and i["formula"] and i["fonte"] and i["periodo"]


def test_painel_com_dados_e_filtros(
    cliente, gestor_municipal, revisor, tecnico_a, arvore_a, ipe, territorios
):
    ins = enviada(cliente, tecnico_a, arvore_a["id"], especie=str(ipe.id))
    cliente.como(revisor).post(
        f"/api/v1/inspecoes/{ins}/validar",
        {"aplicar": ["especie", "condicao_aparente", "medidas"]},
        format="json",
    )
    cliente.como(revisor).post("/api/v1/arvores", {"localizacao": PONTO_B}, format="json")
    corpo = cliente.como(gestor_municipal).get("/api/v1/indicadores/painel").json()
    ind = {i["id"]: i["valor"] for i in corpo["indicadores"]}
    assert ind["arvores_validas"] == 2
    assert ind["especie_confirmada"] == 50.0
    assert ind["cobertura_inspecao"] == 50.0
    assert ind["inspecoes_realizadas"] == 1
    condicoes = {
        c["rotulo"]: c["quantidade"] for c in corpo["distribuicoes"]["condicao_aparente"]["itens"]
    }
    assert condicoes == {"Regular": 1, "Sem avaliação registrada": 1}

    filtrado = cliente.get(
        "/api/v1/indicadores/painel", {"bairro": str(territorios["b"].id)}
    ).json()
    assert {i["id"]: i["valor"] for i in filtrado["indicadores"]}["arvores_validas"] == 1
    assert filtrado["filtros"]["bairro"] == "Bairro B"
    assert cliente.get("/api/v1/indicadores/painel", {"inicio": "x"}).status_code == 400


def test_sem_inspecao_ha_n_dias(cliente, revisor, tecnico_a, arvore_a):
    outra = (
        cliente.como(revisor)
        .post("/api/v1/arvores", {"localizacao": PONTO_A}, format="json")
        .json()
    )
    ins = enviada(cliente, tecnico_a, arvore_a["id"])
    cliente.como(revisor).post(f"/api/v1/inspecoes/{ins}/validar", {"aplicar": []}, format="json")
    ids = [
        a["id"] for a in cliente.get("/api/v1/arvores", {"sem_inspecao_dias": 30}).json()["results"]
    ]
    assert ids == [outra["id"]]
