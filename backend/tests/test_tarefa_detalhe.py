"""M-20: concluir tarefa pede o resultado e, nas de execução em campo, uma foto."""

import pytest

from itree.evidencias.models import EstadoEvidencia, Evidencia
from itree.tarefas.models import (
    TIPOS_COM_EVIDENCIA_OBRIGATORIA,
    EstadoTarefa,
    Tarefa,
    TipoTarefa,
)

from .auditoria_util import eventos_de
from .conftest import PONTO_A, com_escopo, criar_usuario
from .test_evidencias_mapa import s3  # noqa: F401 (fixture do armazenamento simulado)

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
def ocorrencia(cliente, gestor_municipal, tipo_queda):
    return (
        cliente.como(gestor_municipal)
        .post(
            "/api/v1/ocorrencias",
            {"tipo_id": str(tipo_queda.id), "localizacao": PONTO_A, "descricao": "Galho"},
            format="json",
        )
        .json()
    )


def criar_tarefa(cliente, coordenador, tecnico, **corpo):
    r = cliente.como(coordenador).post(
        "/api/v1/tarefas", {"responsavel_id": str(tecnico.id), **corpo}, format="json"
    )
    assert r.status_code == 201, r.json()
    return r.json()


@pytest.fixture
def atendimento(cliente, coordenador, tecnico_a, ocorrencia):
    return criar_tarefa(
        cliente,
        coordenador,
        tecnico_a,
        tipo="atendimento_ocorrencia",
        ocorrencia_id=ocorrencia["id"],
    )


@pytest.fixture
def inspecao_de_arvore(cliente, coordenador, tecnico_a, arvore_a):
    return criar_tarefa(
        cliente, coordenador, tecnico_a, tipo="inspecao_arvore", arvore_id=arvore_a["id"]
    )


def foto(tarefa_id, usuario, nome="poda.jpg", tipo="image/jpeg", estado=EstadoEvidencia.DISPONIVEL):
    return Evidencia.objects.create(
        chave=f"evidencias/teste/{nome}",
        nome_original=nome,
        tipo_conteudo=tipo,
        tamanho=10,
        estado=estado,
        enviada_por=usuario,
        tarefa_id=tarefa_id,
    )


def transicao(cliente, usuario, tarefa, estado, **extras):
    return cliente.como(usuario).post(
        f"/api/v1/tarefas/{tarefa['id']}/transicao", {"estado": estado, **extras}, format="json"
    )


def test_regra_de_evidencia_e_configuracao_documentada():
    assert TIPOS_COM_EVIDENCIA_OBRIGATORIA == {TipoTarefa.ATENDIMENTO_OCORRENCIA}


def test_concluir_exige_o_resultado(cliente, tecnico_a, inspecao_de_arvore):
    transicao(cliente, tecnico_a, inspecao_de_arvore, "em_execucao")
    r = transicao(cliente, tecnico_a, inspecao_de_arvore, "concluida")
    assert r.status_code == 400
    assert Tarefa.objects.get().estado == EstadoTarefa.EM_EXECUCAO
    r = transicao(cliente, tecnico_a, inspecao_de_arvore, "concluida", resultado="   ")
    assert r.status_code == 400
    r = transicao(cliente, tecnico_a, inspecao_de_arvore, "concluida", resultado="Vistoria feita")
    assert r.status_code == 200, r.json()
    assert r.json()["resultado"] == "Vistoria feita"
    assert Tarefa.objects.get().resultado == "Vistoria feita"


def test_tarefa_de_execucao_em_campo_exige_foto_para_concluir(cliente, tecnico_a, atendimento):
    assert atendimento["exige_evidencia"] is True
    transicao(cliente, tecnico_a, atendimento, "em_execucao")
    r = transicao(cliente, tecnico_a, atendimento, "concluida", resultado="Galho removido")
    assert r.status_code == 400
    assert "evidencias" in str(r.json())
    assert Tarefa.objects.get().estado == EstadoTarefa.EM_EXECUCAO


def test_so_conta_foto_disponivel_da_propria_tarefa(cliente, tecnico_a, atendimento):
    transicao(cliente, tecnico_a, atendimento, "em_execucao")
    foto(atendimento["id"], tecnico_a, "a.jpg", estado=EstadoEvidencia.AGUARDANDO_ENVIO)
    foto(atendimento["id"], tecnico_a, "b.jpg", estado=EstadoEvidencia.REMOVIDA)
    foto(atendimento["id"], tecnico_a, "c.pdf", tipo="application/pdf")
    r = transicao(cliente, tecnico_a, atendimento, "concluida", resultado="Feito")
    assert r.status_code == 400, "arquivo pendente, removido ou que não é foto não vale"
    foto(atendimento["id"], tecnico_a, "d.jpg")
    r = transicao(cliente, tecnico_a, atendimento, "concluida", resultado="Feito")
    assert r.status_code == 200, r.json()
    assert r.json()["total_evidencias"] == 2  # o PDF disponível também é anexo
    assert r.json()["concluida_em"]


def test_tarefa_de_inspecao_nao_exige_foto(cliente, tecnico_a, inspecao_de_arvore):
    assert inspecao_de_arvore["exige_evidencia"] is False
    transicao(cliente, tecnico_a, inspecao_de_arvore, "em_execucao")
    r = transicao(cliente, tecnico_a, inspecao_de_arvore, "concluida", resultado="Feita")
    assert r.status_code == 200, r.json()


def test_bloquear_e_cancelar_nao_pedem_resultado_nem_foto(cliente, tecnico_a, atendimento):
    r = transicao(cliente, tecnico_a, atendimento, "bloqueada", motivo="Portão fechado")
    assert r.status_code == 200, r.json()
    r = transicao(cliente, tecnico_a, atendimento, "cancelada", motivo="Duplicada")
    assert r.status_code == 200, r.json()


def test_lista_e_detalhe_trazem_a_contagem_de_evidencias(
    cliente, coordenador, tecnico_a, atendimento
):
    foto(atendimento["id"], tecnico_a, "a.jpg")
    foto(atendimento["id"], tecnico_a, "b.jpg", estado=EstadoEvidencia.REMOVIDA)
    cliente.como(coordenador)
    detalhe = cliente.get(f"/api/v1/tarefas/{atendimento['id']}").json()
    assert detalhe["total_evidencias"] == 1 and detalhe["exige_evidencia"] is True
    lista = cliente.get("/api/v1/tarefas").json()["results"]
    assert [t["total_evidencias"] for t in lista] == [1]


def test_envio_de_evidencia_da_tarefa(cliente, tecnico_a, atendimento, s3):  # noqa: F811
    transicao(cliente, tecnico_a, atendimento, "em_execucao")
    r = cliente.post(
        "/api/v1/evidencias",
        {
            "tarefa": atendimento["id"],
            "nome_original": "poda.jpg",
            "tipo_conteudo": "image/jpeg",
            "tamanho": 5,
        },
        format="json",
    )
    assert r.status_code == 201, r.json()
    evidencia = r.json()["evidencia"]
    s3.put_object(
        Bucket="itree-teste",
        Key=Evidencia.objects.get(pk=evidencia["id"]).chave,
        Body=b"12345",
        ContentType="image/jpeg",
    )
    assert cliente.post(f"/api/v1/evidencias/{evidencia['id']}/confirmar").status_code == 200
    assert len(cliente.get("/api/v1/evidencias", {"tarefa": atendimento["id"]}).json()) == 1
    r = transicao(cliente, tecnico_a, atendimento, "concluida", resultado="Poda feita")
    assert r.status_code == 200, r.json()
    # Concluída, a tarefa não recebe mais evidências.
    r = cliente.post(
        "/api/v1/evidencias",
        {
            "tarefa": atendimento["id"],
            "nome_original": "outra.jpg",
            "tipo_conteudo": "image/jpeg",
            "tamanho": 5,
        },
        format="json",
    )
    assert r.status_code == 400


def test_evidencia_da_tarefa_so_por_quem_atua_nela(
    cliente,
    territorios,
    atendimento,
    s3,  # noqa: F811
):
    outro = com_escopo(criar_usuario("outro@itree.teste", ["tecnico"]), territorios["a"])
    corpo = {
        "tarefa": atendimento["id"],
        "nome_original": "x.jpg",
        "tipo_conteudo": "image/jpeg",
        "tamanho": 5,
    }
    assert cliente.como(outro).post("/api/v1/evidencias", corpo, format="json").status_code == 403
    assert cliente.get("/api/v1/evidencias", {"tarefa": atendimento["id"]}).status_code == 200


def test_evidencia_da_tarefa_aparece_na_auditoria_com_o_codigo_da_tarefa(
    cliente, admin, tecnico_a, atendimento
):
    foto(atendimento["id"], tecnico_a)
    r = cliente.como(admin).get("/api/v1/admin/auditoria", {"codigo": atendimento["codigo"]})
    assert r.status_code == 200
    eventos = eventos_de(r.json())
    filhos = [e for e in eventos if e["entidade"] == "Evidência"]
    assert filhos and filhos[0]["pai"] == {
        "tipo": "tarefa",
        "id": atendimento["id"],
        "codigo": atendimento["codigo"],
    }
