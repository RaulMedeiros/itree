"""G-07: ações em lote nas listas de ocorrências e tarefas."""

import pytest
from django.contrib.gis.geos import Point

from itree.contas.models import Equipe, MembroEquipe
from itree.core.lote import LIMITE_ACOES_EM_LOTE
from itree.inventario.models import Arvore
from itree.notificacoes.models import Notificacao
from itree.ocorrencias.models import Ocorrencia
from itree.tarefas.models import Tarefa

from .conftest import PONTO_A, PONTO_B, com_escopo, criar_usuario

pytestmark = pytest.mark.django_db

OCORRENCIAS = "/api/v1/ocorrencias"
TAREFAS = "/api/v1/tarefas"
EXPORTAR = "/api/v1/relatorios/exportar"


@pytest.fixture
def coordenador(territorios):
    return com_escopo(criar_usuario("coord@itree.teste", ["coordenador"]), territorios["municipio"])


@pytest.fixture
def equipe(db):
    return Equipe.objects.create(nome="Poda A")


def ocorrencia(gestor, tipo, ponto=PONTO_A, **extras) -> Ocorrencia:
    return Ocorrencia.objects.create(
        tipo=tipo,
        geom=Point(ponto["longitude"], ponto["latitude"], srid=4326),
        descricao="Galho no passeio",
        origem="web",
        registrada_por=gestor,
        **extras,
    )


def tarefa(coordenador, ponto=PONTO_A, **extras) -> Tarefa:
    geom = Point(ponto["longitude"], ponto["latitude"], srid=4326)
    return Tarefa.objects.create(
        tipo="inspecao_arvore",
        arvore=Arvore.objects.create(geom=geom),
        geom=geom,
        criada_por=coordenador,
        **extras,
    )


def ids(*objetos):
    return [str(o.pk) for o in objetos]


# --- Ocorrências: reatribuir em lote ---------------------------------------------


def test_reatribuir_ocorrencias_em_lote(cliente, gestor_municipal, tipo_queda, equipe):
    a, b = ocorrencia(gestor_municipal, tipo_queda), ocorrencia(gestor_municipal, tipo_queda)
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/reatribuir",
        {"ids": ids(a, b), "equipe_id": str(equipe.pk), "motivo": "Rodízio da semana"},
        format="json",
    )
    assert r.status_code == 200, r.json()
    assert r.json() == {"atualizadas": 2, "ignoradas": []}
    assert set(Ocorrencia.objects.values_list("equipe_id", flat=True)) == {equipe.pk}
    historico = cliente.get(f"{OCORRENCIAS}/{a.pk}/historico").json()
    assert historico[0]["contexto"]["motivo"] == "Rodízio da semana"
    assert historico[0]["contexto"]["evento"] == "ocorrencias_reatribuidas_em_lote"


def test_reatribuir_so_muda_o_que_veio_no_corpo(cliente, gestor_municipal, tipo_queda, equipe):
    a = ocorrencia(gestor_municipal, tipo_queda, responsavel=gestor_municipal)
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/reatribuir",
        {"ids": ids(a), "equipe_id": str(equipe.pk)},
        format="json",
    )
    assert r.status_code == 200
    a.refresh_from_db()
    assert a.equipe_id == equipe.pk and a.responsavel_id == gestor_municipal.pk
    cliente.post(
        f"{OCORRENCIAS}/lote/reatribuir", {"ids": ids(a), "responsavel_id": None}, format="json"
    )
    a.refresh_from_db()
    assert a.responsavel_id is None and a.equipe_id == equipe.pk


def test_reatribuir_exige_responsavel_ou_equipe(cliente, gestor_municipal, tipo_queda):
    a = ocorrencia(gestor_municipal, tipo_queda)
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/reatribuir", {"ids": ids(a)}, format="json"
    )
    assert r.status_code == 400


def test_lote_ignora_encerradas_e_fora_do_escopo_com_motivo(
    cliente, gestor_municipal, tecnico_a, tipo_queda, equipe
):
    dentro = ocorrencia(gestor_municipal, tipo_queda)
    fora = ocorrencia(gestor_municipal, tipo_queda, ponto=PONTO_B)  # fora do escopo do técnico
    concluida = ocorrencia(gestor_municipal, tipo_queda, estado="concluida")
    corpo = {"ids": ids(dentro, fora, concluida), "equipe_id": str(equipe.pk)}
    r = cliente.como(tecnico_a).post(f"{OCORRENCIAS}/lote/reatribuir", corpo, format="json")
    assert r.status_code == 200
    resultado = r.json()
    assert resultado["atualizadas"] == 1
    assert {i["id"] for i in resultado["ignoradas"]} == {str(fora.pk), str(concluida.pk)}
    fora.refresh_from_db()
    assert fora.equipe_id is None  # a ocorrência fora do escopo não é tocada
    # O técnico não vê a de fora do escopo nem sabe que ela existe: mesmo motivo de "não achada".
    motivo_fora = next(i["motivo"] for i in resultado["ignoradas"] if i["id"] == str(fora.pk))
    assert "escopo" in motivo_fora


def test_lote_respeita_o_limite_de_registros(cliente, gestor_municipal, tipo_queda, equipe):
    a = ocorrencia(gestor_municipal, tipo_queda)
    muitos = [str(a.pk)] + [
        f"00000000-0000-4000-8000-{n:012d}" for n in range(LIMITE_ACOES_EM_LOTE)
    ]
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/reatribuir",
        {"ids": muitos, "equipe_id": str(equipe.pk)},
        format="json",
    )
    assert r.status_code == 400
    assert "ids" in r.json() or "ids" in str(r.json())
    assert Ocorrencia.objects.get().equipe_id is None
    vazio = cliente.post(
        f"{OCORRENCIAS}/lote/reatribuir", {"ids": [], "equipe_id": str(equipe.pk)}, format="json"
    )
    assert vazio.status_code == 400


def test_reatribuir_em_lote_exige_permissao_de_edicao(cliente, tipo_queda, territorios, equipe):
    consulta = com_escopo(
        criar_usuario("consulta@itree.teste", ["consulta"]), territorios["municipio"]
    )
    a = ocorrencia(consulta, tipo_queda)
    r = cliente.como(consulta).post(
        f"{OCORRENCIAS}/lote/reatribuir",
        {"ids": ids(a), "equipe_id": str(equipe.pk)},
        format="json",
    )
    assert r.status_code == 403


# --- Ocorrências: prioridade em lote ---------------------------------------------


def test_prioridade_em_lote_registra_quem_definiu(cliente, gestor_municipal, tipo_queda):
    a, b = ocorrencia(gestor_municipal, tipo_queda), ocorrencia(gestor_municipal, tipo_queda)
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prioridade",
        {"ids": ids(a, b), "prioridade": "urgente", "motivo": "Ventania prevista"},
        format="json",
    )
    assert r.status_code == 200, r.json()
    assert r.json()["atualizadas"] == 2
    for o in Ocorrencia.objects.all():
        assert o.prioridade == "urgente"
        assert o.prioridade_definida_por_id == gestor_municipal.pk
        assert o.prioridade_definida_em is not None
    historico = cliente.get(f"{OCORRENCIAS}/{a.pk}/historico").json()
    assert historico[0]["contexto"]["motivo"] == "Ventania prevista"


def test_prioridade_em_lote_so_pela_gestao(cliente, tecnico_a, gestor_municipal, tipo_queda):
    a = ocorrencia(gestor_municipal, tipo_queda)
    r = cliente.como(tecnico_a).post(
        f"{OCORRENCIAS}/lote/prioridade", {"ids": ids(a), "prioridade": "alta"}, format="json"
    )
    assert r.status_code == 403
    assert Ocorrencia.objects.get().prioridade == ""


def test_prioridade_em_lote_ignora_encerradas(cliente, gestor_municipal, tipo_queda):
    aberta = ocorrencia(gestor_municipal, tipo_queda)
    cancelada = ocorrencia(gestor_municipal, tipo_queda, estado="cancelada")
    r = cliente.como(gestor_municipal).post(
        f"{OCORRENCIAS}/lote/prioridade",
        {"ids": ids(aberta, cancelada), "prioridade": "alta"},
        format="json",
    )
    assert r.json()["atualizadas"] == 1
    assert r.json()["ignoradas"][0]["codigo"] == cancelada.codigo
    cancelada.refresh_from_db()
    assert cancelada.prioridade == ""


# --- Tarefas: reatribuir equipe em lote ------------------------------------------


def test_equipe_em_lote_troca_a_equipe_e_avisa(
    cliente, django_capture_on_commit_callbacks, coordenador, tecnico_a, equipe
):
    MembroEquipe.objects.create(equipe=equipe, usuario=tecnico_a)
    a, b = tarefa(coordenador), tarefa(coordenador)
    with django_capture_on_commit_callbacks(execute=True):
        r = cliente.como(coordenador).post(
            f"{TAREFAS}/lote/equipe",
            {"ids": ids(a, b), "equipe_id": str(equipe.pk), "motivo": "Mutirão"},
            format="json",
        )
    assert r.status_code == 200, r.json()
    assert r.json() == {"atualizadas": 2, "ignoradas": []}
    assert set(Tarefa.objects.values_list("equipe_id", flat=True)) == {equipe.pk}
    historico = cliente.get(f"{TAREFAS}/{a.pk}/historico").json()
    assert historico[0]["contexto"]["motivo"] == "Mutirão"
    assert Notificacao.objects.filter(usuario=tecnico_a).count() == 2


def test_equipe_em_lote_tira_o_responsavel_que_nao_e_da_nova_equipe(
    cliente, coordenador, tecnico_a, equipe
):
    outra = Equipe.objects.create(nome="Poda B")
    MembroEquipe.objects.create(equipe=equipe, usuario=tecnico_a)
    do_time = tarefa(coordenador, responsavel=tecnico_a)
    de_fora = tarefa(coordenador, responsavel=coordenador)
    cliente.como(coordenador).post(
        f"{TAREFAS}/lote/equipe",
        {"ids": ids(do_time, de_fora), "equipe_id": str(equipe.pk)},
        format="json",
    )
    do_time.refresh_from_db()
    de_fora.refresh_from_db()
    assert do_time.responsavel_id == tecnico_a.pk
    assert de_fora.responsavel_id is None
    assert de_fora.equipe_id == equipe.pk != outra.pk


def test_equipe_em_lote_exige_edicao_ignora_encerradas_e_respeita_o_limite(
    cliente, coordenador, gestor_municipal, equipe
):
    aberta = tarefa(coordenador)
    concluida = tarefa(coordenador, estado="concluida")
    outra = tarefa(coordenador, ponto=PONTO_B)
    corpo = {"ids": ids(aberta, concluida, outra), "equipe_id": str(equipe.pk)}
    # Quem só lê tarefas não reatribui.
    assert (
        cliente.como(gestor_municipal)
        .post(f"{TAREFAS}/lote/equipe", corpo, format="json")
        .status_code
        == 403
    )
    r = cliente.como(coordenador).post(f"{TAREFAS}/lote/equipe", corpo, format="json")
    assert r.json()["atualizadas"] == 2 and len(r.json()["ignoradas"]) == 1
    assert r.json()["ignoradas"][0]["codigo"] == concluida.codigo
    muitos = [str(aberta.pk)] + [
        f"00000000-0000-4000-8000-{n:012d}" for n in range(LIMITE_ACOES_EM_LOTE)
    ]
    r = cliente.post(
        f"{TAREFAS}/lote/equipe", {"ids": muitos, "equipe_id": str(equipe.pk)}, format="json"
    )
    assert r.status_code == 400


def test_equipe_em_lote_nao_toca_tarefa_fora_do_escopo_do_coordenador(cliente, territorios, equipe):
    coordenador_a = com_escopo(
        criar_usuario("coord-a@itree.teste", ["coordenador"]), territorios["a"]
    )
    do_b = tarefa(coordenador_a, ponto=PONTO_B)
    r = cliente.como(coordenador_a).post(
        f"{TAREFAS}/lote/equipe", {"ids": ids(do_b), "equipe_id": str(equipe.pk)}, format="json"
    )
    assert r.json()["atualizadas"] == 0
    do_b.refresh_from_db()
    assert do_b.equipe_id is None
