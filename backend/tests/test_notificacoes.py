"""Sino de notificações (RF-SHELL-002): eventos-chave, destinatários e API."""

import uuid

import pytest

from itree.alertas import fontes
from itree.contas.models import Equipe, MembroEquipe
from itree.notificacoes.models import Notificacao

from .conftest import PONTO_A, com_escopo, criar_usuario
from .test_f2 import enviada, inspecao, sincronizar
from .test_f3 import FOCOS

pytestmark = pytest.mark.django_db

URL = "/api/v1/notificacoes"


@pytest.fixture
def executar(django_capture_on_commit_callbacks):
    """Executa os ``on_commit`` registrados dentro do bloco, como numa requisição real."""
    return lambda: django_capture_on_commit_callbacks(execute=True)


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


def tipos(usuario) -> list[str]:
    return list(Notificacao.objects.filter(usuario=usuario).values_list("tipo", flat=True))


# --- Tarefa atribuída à equipe ---------------------------------------------------


def test_tarefa_atribuida_a_equipe_notifica_so_os_membros_no_escopo(
    cliente, executar, coordenador, tecnico_a, arvore_a, territorios
):
    de_b = com_escopo(criar_usuario("tb@itree.teste", ["tecnico"]), territorios["b"])
    de_fora = com_escopo(criar_usuario("tf@itree.teste", ["tecnico"]), territorios["a"])
    equipe = Equipe.objects.create(nome="Poda A")
    for u in (tecnico_a, de_b, coordenador):
        MembroEquipe.objects.create(equipe=equipe, usuario=u)
    corpo = {"tipo": "inspecao_arvore", "arvore_id": arvore_a["id"], "equipe_id": str(equipe.id)}
    with executar():
        r = cliente.como(coordenador).post("/api/v1/tarefas", corpo, format="json")
    assert r.status_code == 201, r.json()
    assert tipos(tecnico_a) == ["tarefa_atribuida"]
    assert tipos(de_b) == []  # o local da tarefa está fora do escopo dele
    assert tipos(de_fora) == []  # não é da equipe
    assert tipos(coordenador) == []  # autor da ação


def test_reatribuir_a_outra_equipe_notifica_e_editar_a_descricao_nao(
    cliente, executar, coordenador, tecnico_a, arvore_a
):
    equipe = Equipe.objects.create(nome="Poda A")
    MembroEquipe.objects.create(equipe=equipe, usuario=tecnico_a)
    t = cliente.como(coordenador).post(
        "/api/v1/tarefas",
        {"tipo": "inspecao_arvore", "arvore_id": arvore_a["id"]},
        format="json",
    )
    assert tipos(tecnico_a) == []
    with executar():
        cliente.patch(f"/api/v1/tarefas/{t.json()['id']}", {"descricao": "Revisar"}, format="json")
    assert tipos(tecnico_a) == []
    with executar():
        cliente.patch(
            f"/api/v1/tarefas/{t.json()['id']}", {"equipe_id": str(equipe.id)}, format="json"
        )
    assert tipos(tecnico_a) == ["tarefa_atribuida"]


def test_transacao_desfeita_nao_notifica(tecnico_a, executar):
    from django.db import transaction

    from itree.notificacoes import servicos

    class Desfazer(Exception):
        pass

    with executar(), pytest.raises(Desfazer), transaction.atomic():
        servicos._agendar([tecnico_a], "tarefa_atribuida", "x", "", "/")
        raise Desfazer
    assert Notificacao.objects.count() == 0
    with executar():
        servicos._agendar([tecnico_a], "tarefa_atribuida", "x", "", "/")
    assert Notificacao.objects.count() == 1


# --- Risco confirmado ------------------------------------------------------------


def test_risco_confirmado_notifica_quem_prioriza_no_escopo(
    cliente, executar, revisor, tipo_queda, territorios, gestor_municipal, coordenador
):
    gestor_b = com_escopo(criar_usuario("gb@itree.teste", ["gestor"]), territorios["b"])
    consulta = com_escopo(criar_usuario("c@itree.teste", ["consulta"]), territorios["municipio"])
    oco = cliente.como(revisor).post(
        "/api/v1/ocorrencias",
        {"tipo_id": str(tipo_queda.id), "localizacao": PONTO_A, "descricao": "Galho"},
        format="json",
    )
    with executar():
        r = cliente.post(
            f"/api/v1/ocorrencias/{oco.json()['id']}/risco",
            {"descricao": "Risco de queda confirmado após avaliação."},
            format="json",
        )
    assert r.status_code == 200, r.json()
    assert tipos(gestor_municipal) == ["risco_confirmado"]
    assert tipos(coordenador) == ["risco_confirmado"]
    assert tipos(gestor_b) == []  # fora do escopo da ocorrência
    assert tipos(consulta) == []  # sem permissão para priorizar
    assert tipos(revisor) == []  # autor
    n = Notificacao.objects.get(usuario=gestor_municipal)
    assert n.link == f"/ocorrencias/{oco.json()['id']}"


# --- Inspeção ----------------------------------------------------------------------


def test_inspecao_enviada_notifica_revisores_no_escopo_e_devolvida_o_autor(
    cliente, executar, tecnico_a, revisor, arvore_a, territorios, gestor_municipal
):
    revisor_b = com_escopo(
        criar_usuario("rb@itree.teste", ["revisor"], registro_profissional="CREA 9"),
        territorios["b"],
    )
    item = inspecao(arvore_a["id"], enviar_para_revisao=True)
    with executar():
        assert sincronizar(cliente, tecnico_a, item).json()[0]["estado"] == "em_revisao"
    assert tipos(revisor) == ["inspecao_para_revisao"]
    assert tipos(revisor_b) == []  # fora do escopo
    assert tipos(gestor_municipal) == []  # não revisa
    assert tipos(tecnico_a) == []  # autor

    with executar():
        r = cliente.como(revisor).post(
            f"/api/v1/inspecoes/{item['id']}/devolver", {"motivo": "Foto ilegível"}, format="json"
        )
    assert r.json()["estado"] == "devolvida"
    assert tipos(tecnico_a) == ["inspecao_devolvida"]
    assert Notificacao.objects.get(usuario=tecnico_a).texto == "Foto ilegível"
    assert tipos(revisor) == ["inspecao_para_revisao"]  # nada novo para o revisor


def test_rascunho_nao_notifica_revisores(cliente, executar, tecnico_a, revisor, arvore_a):
    with executar():
        sincronizar(cliente, tecnico_a, inspecao(arvore_a["id"]))
    assert tipos(revisor) == []


def test_reenvio_apos_devolucao_notifica_de_novo(cliente, executar, tecnico_a, revisor, arvore_a):
    ins = enviada_com_execucao(cliente, executar, tecnico_a, arvore_a)
    cliente.como(revisor).post(
        f"/api/v1/inspecoes/{ins}/devolver", {"motivo": "Corrigir"}, format="json"
    )
    item = {**inspecao(arvore_a["id"]), "id": ins, "versao_base": 2, "enviar_para_revisao": True}
    with executar():
        sincronizar(cliente, tecnico_a, item)
    assert tipos(revisor) == ["inspecao_para_revisao"] * 2


def enviada_com_execucao(cliente, executar, tecnico, arvore):
    with executar():
        return enviada(cliente, tecnico, arvore["id"])


# --- Alertas ambientais -----------------------------------------------------------


def test_alerta_novo_notifica_quem_le_alertas_no_escopo_uma_vez_por_ingestao(
    executar, territorios, gestor_municipal, tecnico_a
):
    analista_b = com_escopo(
        criar_usuario("anb@itree.teste", ["analista_ambiental"]), territorios["b"]
    )
    analista_a = com_escopo(
        criar_usuario("ana@itree.teste", ["analista_ambiental"]), territorios["a"]
    )
    with executar():
        fontes.ingerir("inpe_focos", FOCOS.encode(), "focos.csv")
    # Gestor municipal vê os dois focos; cada analista, o do seu bairro.
    n = Notificacao.objects.get(usuario=gestor_municipal)
    assert n.titulo == "2 novos alertas ambientais"
    assert n.link == "/alertas"
    assert Notificacao.objects.get(usuario=analista_a).titulo == "1 novo alerta ambiental"
    assert Notificacao.objects.get(usuario=analista_a).link.startswith("/alertas/")
    assert Notificacao.objects.filter(usuario=analista_b).count() == 1
    assert tipos(tecnico_a) == []  # técnico não tem alertas.ler
    # Reingerir não duplica nem gera novo aviso.
    with executar():
        fontes.ingerir("inpe_focos", FOCOS.encode(), "focos.csv")
    assert Notificacao.objects.count() == 3


# --- API ----------------------------------------------------------------------------


def criar(usuario, n=1, **extras):
    return [
        Notificacao.objects.create(
            usuario=usuario, tipo="alerta_novo", titulo=f"Aviso {i}", **extras
        )
        for i in range(n)
    ]


def test_listar_traz_nao_lidas_primeiro_e_pagina(cliente, tecnico_a):
    lidas = criar(tecnico_a, 2)
    cliente.como(tecnico_a).post(f"{URL}/{lidas[0].id}/ler")
    nova = criar(tecnico_a, 1)[0]
    corpo = cliente.get(URL, {"tamanho": 2}).json()
    assert corpo["count"] == 3
    assert [i["lida"] for i in corpo["results"]] == [False, False]
    assert corpo["results"][0]["id"] == str(nova.id)
    assert cliente.get(URL, {"tamanho": 2, "pagina": 2}).json()["results"][0]["lida"] is True


def test_contagem_e_marcar_como_lida(cliente, tecnico_a):
    a, _ = criar(tecnico_a, 2)
    assert cliente.como(tecnico_a).get(f"{URL}/contagem").json() == {"nao_lidas": 2}
    r = cliente.post(f"{URL}/{a.id}/ler")
    assert r.status_code == 200 and r.json()["lida"] is True
    assert cliente.get(f"{URL}/contagem").json() == {"nao_lidas": 1}
    # Idempotente: a data da primeira leitura é mantida.
    antes = Notificacao.objects.get(pk=a.id).lida_em
    cliente.post(f"{URL}/{a.id}/ler")
    assert Notificacao.objects.get(pk=a.id).lida_em == antes


def test_marcar_todas_como_lidas(cliente, tecnico_a, revisor):
    criar(tecnico_a, 3)
    criar(revisor, 1)
    r = cliente.como(tecnico_a).post(f"{URL}/ler-todas")
    assert r.json() == {"nao_lidas": 0}
    assert Notificacao.objects.filter(usuario=tecnico_a, lida_em__isnull=True).count() == 0
    assert Notificacao.objects.filter(usuario=revisor, lida_em__isnull=True).count() == 1


def test_usuario_nao_ve_nem_altera_notificacao_de_outro(cliente, tecnico_a, revisor):
    (alheia,) = criar(revisor, 1)
    cliente.como(tecnico_a)
    assert cliente.get(URL).json()["count"] == 0
    assert cliente.get(f"{URL}/contagem").json() == {"nao_lidas": 0}
    assert cliente.post(f"{URL}/{alheia.id}/ler").status_code == 404
    assert cliente.post(f"{URL}/{uuid.uuid4()}/ler").status_code == 404
    cliente.post(f"{URL}/ler-todas")
    alheia.refresh_from_db()
    assert alheia.lida_em is None


def test_api_exige_autenticacao(cliente, db):
    assert cliente.get(URL).status_code in (401, 403)


# --- Tarefa concluída ou bloqueada: avisa quem a criou ---------------------------


@pytest.fixture
def tarefa_do_coordenador(cliente, coordenador, tecnico_a, arvore_a):
    corpo = {
        "tipo": "inspecao_arvore",
        "arvore_id": arvore_a["id"],
        "responsavel_id": str(tecnico_a.id),
    }
    return cliente.como(coordenador).post("/api/v1/tarefas", corpo, format="json").json()


def test_tarefa_bloqueada_e_concluida_notificam_quem_criou(
    cliente, executar, coordenador, tecnico_a, tarefa_do_coordenador
):
    url = f"/api/v1/tarefas/{tarefa_do_coordenador['id']}/transicao"
    with executar():
        r = cliente.como(tecnico_a).post(
            url, {"estado": "bloqueada", "motivo": "Portão fechado"}, format="json"
        )
    assert r.status_code == 200, r.json()
    assert tipos(coordenador) == ["tarefa_bloqueada"]
    aviso = Notificacao.objects.get(usuario=coordenador)
    assert "bloqueada" in aviso.titulo and aviso.texto == "Portão fechado"
    with executar():
        cliente.post(url, {"estado": "em_execucao", "motivo": "Portão liberado"}, format="json")
        cliente.post(url, {"estado": "concluida"}, format="json")
    assert sorted(tipos(coordenador)) == ["tarefa_bloqueada", "tarefa_concluida"]
    assert tipos(tecnico_a) == []  # quem agiu não é avisado


def test_quem_criou_a_tarefa_nao_notifica_a_si_mesmo(
    cliente, executar, coordenador, tarefa_do_coordenador
):
    with executar():
        cliente.como(coordenador).post(
            f"/api/v1/tarefas/{tarefa_do_coordenador['id']}/transicao",
            {"estado": "bloqueada", "motivo": "Sem acesso"},
            format="json",
        )
    assert tipos(coordenador) == []


def test_cancelar_nao_notifica_quem_criou(
    cliente, executar, coordenador, tecnico_a, tarefa_do_coordenador
):
    with executar():
        cliente.como(tecnico_a).post(
            f"/api/v1/tarefas/{tarefa_do_coordenador['id']}/transicao",
            {"estado": "cancelada", "motivo": "Duplicada"},
            format="json",
        )
    assert tipos(coordenador) == []


def test_concluir_a_ocorrencia_avisa_quem_criou_a_tarefa_de_atendimento(
    cliente, executar, coordenador, gestor_municipal, tipo_queda
):
    oco = cliente.como(gestor_municipal).post(
        "/api/v1/ocorrencias",
        {"tipo_id": str(tipo_queda.id), "localizacao": PONTO_A, "descricao": "x"},
        format="json",
    )
    cliente.como(coordenador).post(
        "/api/v1/tarefas",
        {"tipo": "atendimento_ocorrencia", "ocorrencia_id": oco.json()["id"]},
        format="json",
    )
    url = f"/api/v1/ocorrencias/{oco.json()['id']}/transicao"
    cliente.como(gestor_municipal)
    with executar():
        for estado in ("em_triagem", "em_atendimento", "concluida"):
            cliente.post(url, {"estado": estado}, format="json")
    assert tipos(coordenador) == ["tarefa_concluida"]
    assert tipos(gestor_municipal) == []


# --- Retenção ---------------------------------------------------------------------


def test_retencao_apaga_lidas_antigas_e_nao_lidas_muito_antigas(tecnico_a, settings):
    from datetime import timedelta

    from django.utils import timezone

    from itree.notificacoes.tasks import limpar_notificacoes_antigas

    assert settings.NOTIFICACOES_RETENCAO_LIDAS_DIAS == 90
    assert settings.NOTIFICACOES_RETENCAO_NAO_LIDAS_DIAS == 365
    agora = timezone.now()

    def criar(titulo, criada_ha, lida_ha=None):
        n = Notificacao.objects.create(
            usuario=tecnico_a,
            tipo="alerta_novo",
            titulo=titulo,
            lida_em=agora - timedelta(days=lida_ha) if lida_ha is not None else None,
        )
        Notificacao.objects.filter(pk=n.pk).update(criado_em=agora - timedelta(days=criada_ha))

    criar("lida há 91 dias", 120, lida_ha=91)
    criar("lida há 89 dias", 120, lida_ha=89)
    criar("não lida de 366 dias", 366)
    criar("não lida de 364 dias", 364)
    criar("não lida de 100 dias", 100)
    resultado = limpar_notificacoes_antigas()
    assert resultado == {"lidas": 1, "nao_lidas": 1}
    assert set(Notificacao.objects.values_list("titulo", flat=True)) == {
        "lida há 89 dias",
        "não lida de 364 dias",
        "não lida de 100 dias",
    }
    settings.NOTIFICACOES_RETENCAO_LIDAS_DIAS = 30
    assert limpar_notificacoes_antigas()["lidas"] == 1


def test_retencao_esta_agendada_diariamente(settings):
    agenda = settings.CELERY_BEAT_SCHEDULE["limpar-notificacoes"]
    assert agenda["task"] == "itree.notificacoes.tasks.limpar_notificacoes_antigas"


# --- Central de notificações: filtros e agrupamento (G-09) -------------------------


def criar_tipo(usuario, tipo, titulo, n=1, dias_atras=0, **extras):
    from datetime import timedelta

    from django.utils import timezone

    itens = [
        Notificacao.objects.create(usuario=usuario, tipo=tipo, titulo=f"{titulo} {i}", **extras)
        for i in range(n)
    ]
    Notificacao.objects.filter(pk__in=[i.pk for i in itens]).update(
        criado_em=timezone.now() - timedelta(days=dias_atras)
    )
    return itens


def test_listar_filtra_por_tipo_e_por_lida(cliente, tecnico_a):
    criar_tipo(tecnico_a, "alerta_novo", "Alerta", 2)
    (tarefa,) = criar_tipo(tecnico_a, "tarefa_atribuida", "Tarefa")
    cliente.como(tecnico_a).post(f"{URL}/{tarefa.id}/ler")
    por_tipo = cliente.get(URL, {"tipo": "alerta_novo"}).json()
    assert por_tipo["count"] == 2
    assert {i["tipo"] for i in por_tipo["results"]} == {"alerta_novo"}
    assert cliente.get(URL, {"lida": "true"}).json()["count"] == 1
    assert cliente.get(URL, {"lida": "false"}).json()["count"] == 2
    assert cliente.get(URL, {"tipo": "tarefa_atribuida", "lida": "false"}).json()["count"] == 0
    assert cliente.get(URL, {"tipo": "inexistente"}).status_code == 400
    assert cliente.get(URL, {"lida": "talvez"}).status_code == 400


def test_filtros_nao_vazam_notificacoes_de_outro_usuario(cliente, tecnico_a, revisor):
    criar_tipo(revisor, "alerta_novo", "Alerta", 3)
    assert cliente.como(tecnico_a).get(URL, {"tipo": "alerta_novo"}).json()["count"] == 0


def test_agrupadas_juntam_o_mesmo_tipo_no_mesmo_dia(cliente, revisor):
    criar_tipo(revisor, "inspecao_para_revisao", "Inspeção", 5, link="/inspecoes/x")
    criar_tipo(revisor, "inspecao_para_revisao", "Inspeção antiga", 2, dias_atras=3)
    (unica,) = criar_tipo(revisor, "risco_confirmado", "Risco", link="/ocorrencias/1")
    grupos = cliente.como(revisor).get(f"{URL}/agrupadas").json()
    assert len(grupos) == 3
    por_tipo = {(g["tipo"], g["quantidade"]): g for g in grupos}
    revisao = por_tipo[("inspecao_para_revisao", 5)]
    assert revisao["titulo"] == "5 inspeções aguardando revisão"
    assert revisao["link"] == "/inspecoes" and revisao["nao_lidas"] == 5
    assert por_tipo[("inspecao_para_revisao", 2)]["titulo"] == "2 inspeções aguardando revisão"
    # Um só evento mantém título e link próprios.
    risco = por_tipo[("risco_confirmado", 1)]
    assert risco["titulo"] == unica.titulo and risco["link"] == "/ocorrencias/1"


def test_agrupadas_trazem_nao_lidas_primeiro_e_respeitam_o_limite(cliente, revisor):
    lidas = criar_tipo(revisor, "alerta_novo", "Alerta", 2, dias_atras=0)
    cliente.como(revisor)
    for n in lidas:
        cliente.post(f"{URL}/{n.id}/ler")
    criar_tipo(revisor, "tarefa_concluida", "Tarefa", 1, dias_atras=5)
    grupos = cliente.get(f"{URL}/agrupadas").json()
    # O grupo com não lidas vem antes, mesmo sendo mais antigo.
    assert [g["tipo"] for g in grupos] == ["tarefa_concluida", "alerta_novo"]
    assert [g["lida"] for g in grupos] == [False, True]
    assert len(cliente.get(f"{URL}/agrupadas", {"limite": 1}).json()) == 1
    assert cliente.get(f"{URL}/agrupadas", {"limite": "x"}).status_code == 400


def test_agrupadas_so_do_proprio_usuario(cliente, tecnico_a, revisor):
    criar_tipo(revisor, "alerta_novo", "Alerta", 4)
    assert cliente.como(tecnico_a).get(f"{URL}/agrupadas").json() == []


def test_ler_grupo_marca_so_o_tipo_e_o_dia_pedidos(cliente, revisor, tecnico_a):
    from django.utils import timezone

    criar_tipo(revisor, "inspecao_para_revisao", "Hoje", 3)
    criar_tipo(revisor, "inspecao_para_revisao", "Ontem", 2, dias_atras=1)
    criar_tipo(revisor, "alerta_novo", "Outro tipo", 1)
    criar_tipo(tecnico_a, "inspecao_para_revisao", "De outro", 1)
    hoje = timezone.localdate().isoformat()
    r = cliente.como(revisor).post(
        f"{URL}/ler-grupo", {"tipo": "inspecao_para_revisao", "dia": hoje}, format="json"
    )
    assert r.status_code == 200 and r.json() == {"nao_lidas": 3}
    assert Notificacao.objects.filter(usuario=revisor, lida_em__isnull=True).count() == 3
    assert Notificacao.objects.get(usuario=tecnico_a).lida_em is None
    assert (
        cliente.post(f"{URL}/ler-grupo", {"tipo": "x", "dia": hoje}, format="json").status_code
        == 400
    )
