"""Códigos internos (DP-xx, RN-xx, RF-xx) não chegam ao usuário final (R2-14)."""

import json

import pytest

from itree.alertas.fontes import PROVENIENCIA_FONTE
from itree.alertas.models import IngestaoAlertas
from itree.core.textos import CODIGO_INTERNO, sem_codigos_internos
from itree.indicadores import externos

pytestmark = pytest.mark.django_db


def test_textos_de_proveniencia_das_fontes_nao_tem_codigo():
    for fonte, dados in PROVENIENCIA_FONTE.items():
        assert not CODIGO_INTERNO.search(dados["licenca"]), fonte
    assert not CODIGO_INTERNO.search(externos.LICENCA_CENSO)


def test_painel_nao_expoe_codigos_nas_definicoes(cliente, gestor_municipal):
    corpo = cliente.como(gestor_municipal).get("/api/v1/indicadores/painel").json()
    assert corpo["indicadores"]
    assert not CODIGO_INTERNO.search(json.dumps(corpo, ensure_ascii=False))


def test_ingestao_antiga_com_codigo_na_licenca_sai_sem_ele(cliente, admin):
    IngestaoAlertas.objects.create(
        fonte="inpe_focos",
        origem="focos.csv",
        sucesso=True,
        orgao="INPE, Programa Queimadas",
        licenca="Não declarada pela fonte (DP-11). Citar: INPE, Programa Queimadas.",
    )
    licenca = cliente.como(admin).get("/api/v1/alertas/ingestoes").json()[0]["licenca"]
    assert licenca == (
        "Não declarada pela fonte (em definição pela prefeitura). Citar: INPE, Programa Queimadas."
    )


def test_sem_codigos_internos():
    assert sem_codigos_internos("Citar: INPE (DP-11).") == (
        "Citar: INPE (em definição pela prefeitura)."
    )
    assert sem_codigos_internos("Medida com origem (RN-INV-001).") == "Medida com origem."
    assert sem_codigos_internos("ativa, com origem (RN-INV-001, provisório)") == (
        "ativa, com origem (provisório)"
    )
    assert sem_codigos_internos("Sem código algum.") == "Sem código algum."
