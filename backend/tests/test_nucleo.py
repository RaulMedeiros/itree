import pytest

from itree.contas.permissoes import MATRIZ, Papel, Permissao, permissoes_efetivas
from itree.core.ids import uuid7


def test_uuid7_versao_variante_e_ordem():
    ids = [uuid7() for _ in range(200)]
    assert all(i.version == 7 for i in ids)
    assert all(i.variant == "specified in RFC 4122" for i in ids)
    # Ordenável por tempo em granularidade de milissegundo.
    assert [i.int >> 80 for i in ids] == sorted(i.int >> 80 for i in ids)
    assert len(set(ids)) == len(ids)


def test_todo_papel_tem_permissoes_validas():
    validas = set(Permissao.values)
    assert set(MATRIZ) == set(Papel.values)
    for permissoes in MATRIZ.values():
        assert permissoes <= validas


def test_risco_confirmado_exige_qualificacao():
    assert Permissao.OCORRENCIAS_CONFIRMAR_RISCO not in permissoes_efetivas(
        ["revisor"], qualificado=False
    )
    assert Permissao.OCORRENCIAS_CONFIRMAR_RISCO in permissoes_efetivas(
        ["revisor"], qualificado=True
    )


def test_permissoes_sao_uniao_dos_papeis():
    efetivas = permissoes_efetivas(["consulta", "coordenador"], qualificado=False)
    assert Permissao.TAREFAS_EDITAR in efetivas
    assert Permissao.ALERTAS_LER in efetivas


def test_papel_desconhecido_nao_concede_nada():
    assert permissoes_efetivas(["inexistente"], qualificado=True) == frozenset()


@pytest.mark.django_db
def test_saude(cliente):
    resposta = cliente.get("/api/v1/saude")
    assert resposta.status_code == 200
    assert resposta.json()["banco"] == "ok"
