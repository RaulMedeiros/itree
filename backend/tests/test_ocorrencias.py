from datetime import timedelta

import pytest
from django.utils import timezone

from .conftest import PONTO_A, PONTO_B, com_escopo, criar_usuario

pytestmark = pytest.mark.django_db

URL = "/api/v1/ocorrencias"


def nova(cliente, usuario, tipo, **dados):
    corpo = {
        "tipo_id": str(tipo.id),
        "localizacao": PONTO_A,
        "descricao": "Galho no passeio",
        **dados,
    }
    return cliente.como(usuario).post(URL, corpo, format="json")


def test_criar_a_partir_de_arvore_herda_local_e_prazo(cliente, tecnico_a, tipo_queda):
    arvore = (
        cliente.como(tecnico_a)
        .post("/api/v1/arvores", {"localizacao": PONTO_A}, format="json")
        .json()
    )
    r = nova(
        cliente,
        tecnico_a,
        tipo_queda,
        localizacao=None,
        arvore_id=arvore["id"],
        condicao_aparente="Galho aparentemente quebrado",
    )
    corpo = r.json()
    assert r.status_code == 201, corpo
    assert corpo["codigo"].startswith("OCO-")
    assert corpo["arvore"]["codigo"] == arvore["codigo"]
    assert corpo["localizacao"] == arvore["localizacao"]
    assert corpo["bairro"]["nome"] == "Bairro A"
    assert corpo["prazo"] == str(timezone.localdate() + timedelta(days=3))
    assert corpo["estado"] == "aberta"
    assert corpo["prioridade"] == ""  # nunca derivada da condição (RN-OCO-001)
    assert corpo["risco_confirmado"] is False


def test_fora_do_escopo(cliente, tecnico_a, tipo_queda):
    assert nova(cliente, tecnico_a, tipo_queda, localizacao=PONTO_B).status_code == 400


def test_fluxo_de_estados(cliente, gestor_municipal, tipo_queda):
    oco = nova(cliente, gestor_municipal, tipo_queda).json()
    url = f"{URL}/{oco['id']}/transicao"
    assert oco["transicoes_possiveis"] == ["em_triagem", "cancelada"]
    assert cliente.post(url, {"estado": "concluida"}, format="json").status_code == 400
    for estado in ("em_triagem", "em_atendimento", "concluida"):
        r = cliente.post(url, {"estado": estado}, format="json")
        assert r.status_code == 200, r.json()
    assert r.json()["concluida_em"] is not None
    assert cliente.patch(f"{URL}/{oco['id']}", {"descricao": "x"}, format="json").status_code == 400


def test_cancelar_exige_justificativa(cliente, gestor_municipal, tipo_queda):
    oco = nova(cliente, gestor_municipal, tipo_queda).json()
    url = f"{URL}/{oco['id']}/transicao"
    assert cliente.post(url, {"estado": "cancelada"}, format="json").status_code == 400
    r = cliente.post(url, {"estado": "cancelada", "motivo": "Registro duplicado"}, format="json")
    assert r.json()["estado"] == "cancelada"
    historico = cliente.get(f"{URL}/{oco['id']}/historico").json()
    assert historico[0]["contexto"]["motivo"] == "Registro duplicado"


def test_prioridade_so_pela_gestao(cliente, tecnico_a, gestor_municipal, tipo_queda):
    oco = nova(cliente, tecnico_a, tipo_queda).json()
    url = f"{URL}/{oco['id']}/prioridade"
    assert (
        cliente.como(tecnico_a).post(url, {"prioridade": "alta"}, format="json").status_code == 403
    )
    r = cliente.como(gestor_municipal).post(url, {"prioridade": "alta"}, format="json")
    assert r.json()["prioridade"] == "alta"
    assert r.json()["prioridade_definida_por"]["email"] == "gm@itree.teste"


def test_risco_confirmado_exige_revisor_qualificado(cliente, revisor, territorios, tipo_queda):
    sem_registro = com_escopo(
        criar_usuario("r2@itree.teste", ["revisor"]), territorios["municipio"]
    )
    oco = nova(cliente, revisor, tipo_queda).json()
    url = f"{URL}/{oco['id']}/risco"
    dados = {"descricao": "Risco de queda confirmado após avaliação com resistógrafo."}
    assert cliente.como(sem_registro).post(url, dados, format="json").status_code == 403
    r = cliente.como(revisor).post(url, dados, format="json")
    assert r.status_code == 200
    assert r.json()["risco_responsavel"]["email"] == "revisor@itree.teste"
    assert cliente.post(url, dados, format="json").status_code == 400


def test_filtros(cliente, gestor_municipal, tipo_queda):
    a = nova(
        cliente, gestor_municipal, tipo_queda, prazo=str(timezone.localdate() - timedelta(days=1))
    ).json()
    b = nova(cliente, gestor_municipal, tipo_queda, localizacao=PONTO_B).json()
    cliente.post(
        f"{URL}/{b['id']}/transicao", {"estado": "cancelada", "motivo": "x"}, format="json"
    )
    ids = lambda **p: [o["id"] for o in cliente.get(URL, p).json()["results"]]  # noqa: E731
    assert ids(estado="abertas") == [a["id"]]
    assert ids(atrasadas="true") == [a["id"]]
    assert ids(busca=a["codigo"]) == [a["id"]]
    assert cliente.get(URL, {"tipo": "nao-uuid"}).status_code == 400


def test_ordenar_por_urgencia_prazo_depois_prioridade(cliente, gestor_municipal, tipo_queda):
    hoje = timezone.localdate()
    tarde = nova(cliente, gestor_municipal, tipo_queda, prazo=str(hoje + timedelta(days=9))).json()
    atrasada = nova(
        cliente, gestor_municipal, tipo_queda, prazo=str(hoje - timedelta(days=2))
    ).json()
    cedo_baixa = nova(
        cliente, gestor_municipal, tipo_queda, prazo=str(hoje + timedelta(days=1))
    ).json()
    cedo_urgente = nova(
        cliente, gestor_municipal, tipo_queda, prazo=str(hoje + timedelta(days=1))
    ).json()
    for o, prio in ((cedo_baixa, "baixa"), (cedo_urgente, "urgente")):
        r = cliente.post(
            f"{URL}/{o['id']}/prioridade", {"prioridade": prio, "motivo": "teste"}, format="json"
        )
        assert r.status_code == 200, r.json()
    ids = [o["id"] for o in cliente.get(URL, {"ordenar": "urgencia"}).json()["results"]]
    assert ids == [atrasada["id"], cedo_urgente["id"], cedo_baixa["id"], tarde["id"]]


def test_escopo_na_listagem(cliente, tecnico_a, gestor_municipal, tipo_queda):
    nova(cliente, gestor_municipal, tipo_queda, localizacao=PONTO_B)
    assert cliente.como(tecnico_a).get(URL).json()["count"] == 0
    assert cliente.como(gestor_municipal).get(URL).json()["count"] == 1


def test_tipos_de_ocorrencia(cliente, admin, tecnico_a, tipo_queda):
    assert [t["nome"] for t in cliente.como(tecnico_a).get("/api/v1/tipos-ocorrencia").json()] == [
        "Galho caído"
    ]
    r = cliente.como(admin).post(
        "/api/v1/tipos-ocorrencia", {"nome": "Raiz danificando calçada"}, format="json"
    )
    assert r.status_code == 201


def test_tipos_trazem_contagem_por_situacao_no_escopo_de_quem_consulta(
    cliente, tecnico_a, gestor_municipal, tipo_queda, territorios
):
    from django.contrib.gis.geos import Point

    from itree.ocorrencias.models import Ocorrencia, TipoOcorrencia

    TipoOcorrencia.objects.create(nome="Poda")

    def criar(tipo, ponto, estado):
        Ocorrencia.objects.create(
            tipo=tipo,
            geom=Point(ponto["longitude"], ponto["latitude"], srid=4326),
            descricao="x",
            origem="web",
            registrada_por=gestor_municipal,
            estado=estado,
        )

    for estado in ("aberta", "aberta", "em_atendimento", "concluida", "cancelada", "em_triagem"):
        criar(tipo_queda, PONTO_A, estado)
    criar(tipo_queda, PONTO_B, "aberta")  # fora do escopo do técnico
    criar(tipo_queda, PONTO_B, "concluida")

    def contagens(usuario):
        tipos = cliente.como(usuario).get("/api/v1/tipos-ocorrencia").json()
        return {t["nome"]: t["ocorrencias_por_estado"] for t in tipos}

    todos = contagens(gestor_municipal)
    assert todos["Galho caído"] == {
        "aberta": 3,
        "em_triagem": 1,
        "encaminhada": 0,
        "em_atendimento": 1,
        "concluida": 2,
        "cancelada": 1,
    }
    assert set(todos["Poda"].values()) == {0}  # tipo sem ocorrências: zeros, não ausente
    assert contagens(tecnico_a)["Galho caído"]["aberta"] == 2
    assert contagens(tecnico_a)["Galho caído"]["concluida"] == 1
