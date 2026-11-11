"""R2-12: fila de revisão de inspeções ordenável e filtrável."""

from datetime import timedelta

import pytest
from django.utils import timezone

from itree.inspecoes.models import Inspecao

from .conftest import PONTO_A
from .test_f2 import enviada

pytestmark = pytest.mark.django_db


@pytest.fixture
def arvore_a(cliente, revisor):
    return (
        cliente.como(revisor)
        .post("/api/v1/arvores", {"localizacao": PONTO_A}, format="json")
        .json()
    )


# --- R2-12: fila de revisão -------------------------------------------------------


def _fila(cliente, **params):
    r = cliente.get("/api/v1/inspecoes", {"estado": "em_revisao", **params})
    assert r.status_code == 200, r.json()
    return [i["codigo"] for i in r.json()["results"]]


@pytest.fixture
def fila(cliente, tecnico_a, arvore_a):
    """Três inspeções em revisão, recebidas em ordem diferente da realizada."""
    ids = {}
    for nome, condicao, encaminhar in (
        ("regular", "regular", False),
        ("ruim", "ruim", True),
        ("boa", "boa", False),
    ):
        ids[nome] = enviada(
            cliente, tecnico_a, arvore_a["id"], condicao_aparente=condicao,
            requer_encaminhamento=encaminhar,
        )  # fmt: skip
    agora = timezone.now()
    # Recebidas: regular (há 5 dias), ruim (há 3), boa (há 1). Realizadas na ordem inversa.
    for nome, dias_receb, dias_real in (("regular", 5, 1), ("ruim", 3, 2), ("boa", 1, 3)):
        Inspecao.objects.filter(pk=ids[nome]).update(
            recebida_em=agora - timedelta(days=dias_receb),
            realizada_em=agora - timedelta(days=dias_real),
        )
    codigos = {n: Inspecao.objects.get(pk=i).codigo for n, i in ids.items()}
    return codigos


def test_fila_ordena_por_recebimento_e_por_condicao(cliente, revisor, fila):
    cliente.como(revisor)
    assert _fila(cliente, ordenar="recebida_em") == [fila["regular"], fila["ruim"], fila["boa"]]
    assert _fila(cliente, ordenar="-recebida_em") == [fila["boa"], fila["ruim"], fila["regular"]]
    # Da pior condição para a melhor.
    assert _fila(cliente, ordenar="condicao") == [fila["ruim"], fila["regular"], fila["boa"]]
    # Padrão antigo preservado: mais recentemente realizada primeiro.
    assert _fila(cliente) == [fila["regular"], fila["ruim"], fila["boa"]]
    assert _fila(cliente, ordenar="realizada_em") == [fila["boa"], fila["ruim"], fila["regular"]]


def test_fila_filtra_por_encaminhamento_e_condicao(cliente, revisor, fila):
    cliente.como(revisor)
    assert _fila(cliente, requer_encaminhamento="true") == [fila["ruim"]]
    assert sorted(_fila(cliente, condicao="boa,regular")) == sorted([fila["boa"], fila["regular"]])
    assert _fila(cliente, condicao="ruim", requer_encaminhamento="true") == [fila["ruim"]]
    assert _fila(cliente, condicao="morta") == []
