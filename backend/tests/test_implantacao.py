"""Primeiros passos da implantação (G-03): checklist calculado no servidor."""

import pytest

from itree.contas.models import Equipe, MembroEquipe, TerritorioEquipe
from itree.inventario.models import Especie, EstadoLote, LoteImportacao

from .conftest import criar_usuario

pytestmark = pytest.mark.django_db

URL = "/api/v1/implantacao/primeiros-passos"


def passos(cliente, usuario):
    r = cliente.como(usuario).get(URL)
    assert r.status_code == 200
    corpo = r.json()
    return corpo["completo"], {p["id"]: p for p in corpo["passos"]}


def test_so_administrador_ve_o_checklist(cliente, gestor):
    assert cliente.como(gestor).get(URL).status_code == 403


def test_sistema_vazio_tem_todos_os_passos_pendentes_com_link(cliente, admin, settings):
    settings.ALERTAS_FONTES = {}
    completo, p = passos(cliente, admin)
    assert completo is False
    assert list(p) == ["territorios", "especies", "equipes", "inventario", "fontes"]
    assert not any(x["concluido"] for x in p.values())
    assert p["territorios"]["link"] == "/administracao/territorios"
    assert p["especies"]["link"] == "/inventario/especies"
    assert p["equipes"]["link"] == "/administracao/equipes"
    assert p["inventario"]["link"] == "/inventario/importacoes"
    assert p["fontes"]["link"] == "/administracao/integracoes"


def test_territorios_e_especies_marcam_o_passo(cliente, admin, territorios, settings):
    settings.ALERTAS_FONTES = {}
    Especie.objects.create(nome_cientifico="Licania tomentosa")
    Especie.objects.create(nome_cientifico="Inativa sp.", ativa=False)
    _, p = passos(cliente, admin)
    assert p["territorios"]["concluido"] and "3 territórios" in p["territorios"]["detalhe"]
    assert p["especies"]["concluido"] and p["especies"]["detalhe"] == "1 espécie ativa."


def test_equipe_so_conta_com_membro_e_territorio(cliente, admin, territorios, settings):
    settings.ALERTAS_FONTES = {}
    equipe = Equipe.objects.create(nome="Poda")
    assert passos(cliente, admin)[1]["equipes"]["concluido"] is False
    MembroEquipe.objects.create(equipe=equipe, usuario=criar_usuario("m@itree.teste", ["tecnico"]))
    # Falta o território.
    assert passos(cliente, admin)[1]["equipes"]["concluido"] is False
    TerritorioEquipe.objects.create(equipe=equipe, territorio=territorios["a"])
    p = passos(cliente, admin)[1]["equipes"]
    assert p["concluido"] and p["detalhe"] == "1 equipe completa."
    # Equipe desativada não conta.
    Equipe.objects.filter(pk=equipe.pk).update(ativa=False)
    assert passos(cliente, admin)[1]["equipes"]["concluido"] is False


def test_inventario_so_conta_importacao_confirmada(cliente, admin, settings):
    settings.ALERTAS_FONTES = {}
    lote = LoteImportacao.objects.create(
        arquivo_nome="a.csv", formato="csv", fonte="Teste", usuario=admin
    )
    assert passos(cliente, admin)[1]["inventario"]["concluido"] is False
    LoteImportacao.objects.filter(pk=lote.pk).update(estado=EstadoLote.CONFIRMADO)
    assert passos(cliente, admin)[1]["inventario"]["concluido"] is True


def test_fontes_externas_dependem_da_configuracao(cliente, admin, settings):
    settings.ALERTAS_FONTES = {}
    assert passos(cliente, admin)[1]["fontes"]["concluido"] is False
    settings.ALERTAS_FONTES = {"inpe_focos": "https://fonte.teste/focos.csv"}
    assert passos(cliente, admin)[1]["fontes"]["concluido"] is True


def test_completo_quando_todos_os_passos_estao_feitos(cliente, admin, territorios, settings):
    settings.ALERTAS_FONTES = {"inpe_focos": "https://fonte.teste/focos.csv"}
    Especie.objects.create(nome_cientifico="Licania tomentosa")
    equipe = Equipe.objects.create(nome="Poda")
    MembroEquipe.objects.create(equipe=equipe, usuario=admin)
    TerritorioEquipe.objects.create(equipe=equipe, territorio=territorios["a"])
    LoteImportacao.objects.create(
        arquivo_nome="a.csv",
        formato="csv",
        fonte="Teste",
        usuario=admin,
        estado=EstadoLote.CONFIRMADO,
    )
    completo, p = passos(cliente, admin)
    assert completo is True and all(x["concluido"] for x in p.values())
