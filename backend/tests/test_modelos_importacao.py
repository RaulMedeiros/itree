"""Modelos de importação: mapeamento de colunas salvo por fonte (RF-INV-019)."""

import pytest

from itree.inventario.models import ModeloImportacao

pytestmark = pytest.mark.django_db

URL = "/api/v1/modelos-importacao"
MAPEAMENTO = {"latitude": "lat", "longitude": "lon", "id_externo": "codigo", "especie": "especie"}


def criar(cliente, **extras):
    corpo = {"nome": "Colunas padrão", "fonte": "Inventário 2019", "mapeamento": MAPEAMENTO}
    return cliente.post(URL, {**corpo, **extras}, format="json")


def test_criar_e_sugerir_pela_fonte(cliente, revisor):
    cliente.como(revisor)
    r = criar(cliente, srid=31984)
    assert r.status_code == 201, r.json()
    modelo = r.json()
    assert modelo["mapeamento"] == MAPEAMENTO and modelo["srid"] == 31984
    assert modelo["criado_por_nome"] == revisor.nome
    criar(cliente, nome="Outra fonte", fonte="Cadastro 2022")

    # A tela consulta pela fonte digitada; maiúsculas e caixa não importam.
    r = cliente.get(URL, {"fonte": "inventário 2019"})
    assert [m["id"] for m in r.json()["results"]] == [modelo["id"]]
    assert cliente.get(URL, {"fonte": "Fonte desconhecida"}).json()["count"] == 0
    assert cliente.get(URL).json()["count"] == 2


def test_nome_unico_por_fonte(cliente, revisor):
    cliente.como(revisor)
    assert criar(cliente).status_code == 201
    r = criar(cliente)
    assert r.status_code == 400
    assert criar(cliente, fonte="Outra fonte").status_code == 201


def test_editar_e_apagar(cliente, revisor):
    cliente.como(revisor)
    modelo = criar(cliente).json()
    r = cliente.patch(
        f"{URL}/{modelo['id']}",
        {"nome": "Renomeado", "mapeamento": {"latitude": "y", "longitude": "x"}},
        format="json",
    )
    assert r.status_code == 200, r.json()
    assert r.json()["nome"] == "Renomeado" and r.json()["mapeamento"] == {
        "latitude": "y",
        "longitude": "x",
    }
    assert cliente.delete(f"{URL}/{modelo['id']}").status_code == 204
    assert not ModeloImportacao.objects.exists()


def test_mapeamento_aceita_so_campos_conhecidos_e_descarta_vazios(cliente, revisor):
    cliente.como(revisor)
    r = criar(cliente, mapeamento={"cor_da_casca": "cor"})
    assert r.status_code == 400 and "cor_da_casca" in str(r.json())
    r = criar(cliente, mapeamento={"latitude": "lat", "altura": ""})
    assert r.status_code == 201 and r.json()["mapeamento"] == {"latitude": "lat"}


def test_exige_a_permissao_de_importar(cliente, tecnico_a, revisor):
    modelo = criar(cliente.como(revisor)).json()
    cliente.como(tecnico_a)
    assert cliente.get(URL).status_code == 403
    assert criar(cliente).status_code == 403
    assert cliente.patch(f"{URL}/{modelo['id']}", {"nome": "x"}, format="json").status_code == 403
    assert cliente.delete(f"{URL}/{modelo['id']}").status_code == 403
    assert ModeloImportacao.objects.count() == 1


def test_alteracoes_ficam_na_auditoria(cliente, revisor):
    from django.apps import apps

    cliente.como(revisor)
    modelo = criar(cliente).json()
    cliente.patch(f"{URL}/{modelo['id']}", {"nome": "Novo nome"}, format="json")
    cliente.delete(f"{URL}/{modelo['id']}")
    eventos = apps.get_model("inventario", "ModeloImportacaoEvent").objects
    assert sorted(eventos.values_list("pgh_label", flat=True)) == ["delete", "insert", "update"]
