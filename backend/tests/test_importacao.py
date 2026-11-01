import json

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from itree.inventario.models import Arvore, Especie, IdentificadorExterno, Medida

pytestmark = pytest.mark.django_db

URL = "/api/v1/importacoes"

CSV = (
    "codigo;especie;lat;lon;altura_m;dap_cm;rua\n"
    "A1;Licania tomentosa;-3,755;-38,555;8,5;30;Rua 1\n"
    "A2;Especie desconhecida;-3,756;-38,556;;;Rua 2\n"
    "A3;Licania tomentosa;;;;;Rua 3\n"
    "A1;Licania tomentosa;-3,757;-38,557;abc;;Rua 4\n"
)


def enviar(cliente, conteudo, nome="inventario.csv", **campos):
    dados = {
        "arquivo": SimpleUploadedFile(nome, conteudo.encode()),
        "fonte": "Inventário 2019",
        "data_referencia": "2019-06-01",
        "campo_latitude": "lat",
        "campo_longitude": "lon",
        "campo_id_externo": "codigo",
        "campo_especie": "especie",
        "campo_altura": "altura_m",
        "campo_dap": "dap_cm",
        "campo_endereco": "rua",
        **campos,
    }
    return cliente.post(URL, dados, format="multipart")


@pytest.fixture
def licania(db):
    return Especie.objects.create(nome_cientifico="Licania tomentosa")


def test_colunas_do_arquivo(cliente, revisor):
    r = cliente.como(revisor).post(
        f"{URL}/colunas", {"arquivo": SimpleUploadedFile("x.csv", CSV.encode())}, format="multipart"
    )
    assert r.status_code == 200
    assert r.json()["colunas"][:3] == ["codigo", "especie", "lat"]
    assert r.json()["total_linhas"] == 4


def test_pre_visualizacao_nao_cria_nada(cliente, revisor, licania):
    r = enviar(cliente.como(revisor), CSV)
    assert r.status_code == 201, r.json()
    lote = r.json()
    assert lote["estado"] == "pre_visualizado"
    assert (lote["total_linhas"], lote["linhas_validas"]) == (4, 2)
    linhas = {linha["indice"]: linha for linha in lote["linhas"]}
    assert linhas[1]["dados"]["especie_id"] == str(licania.id)
    assert linhas[1]["dados"]["altura"] == "8.5"
    assert "não encontrada no catálogo" in linhas[2]["avisos"][0]
    assert linhas[3]["erros"] == ["Sem coordenadas."]
    assert any("repetido" in e for e in linhas[4]["erros"])
    assert any("inválido" in e for e in linhas[4]["erros"])
    assert Arvore.objects.count() == 0


def test_confirmar_cria_com_proveniencia_e_reimportar_nao_duplica(cliente, revisor, licania):
    lote = enviar(cliente.como(revisor), CSV).json()
    r = cliente.post(f"{URL}/{lote['id']}/confirmar")
    assert r.status_code == 200, r.json()
    assert r.json()["arvores_criadas"] == 2

    arvore = Arvore.objects.get(identificadores__valor="A1")
    assert arvore.localizacao_origem == "importada"
    assert arvore.origem_registro == "importacao"
    assert arvore.especie_estado == "informada"
    assert arvore.bairro.nome == "Bairro A"
    medidas = {m.tipo: m for m in Medida.objects.filter(arvore=arvore)}
    assert medidas["altura"].origem == "importado"
    assert str(medidas["dap"].valor) == "30.00"
    assert str(medidas["altura"].data_medicao) == "2019-06-01"
    sem_catalogo = Arvore.objects.get(identificadores__valor="A2")
    assert sem_catalogo.especie_texto_original == "Especie desconhecida"

    # CA-INV-006: reimportar o mesmo arquivo não cria duplicatas silenciosas.
    segundo = enviar(cliente, CSV).json()
    assert segundo["linhas_validas"] == 0
    assert any("já importado" in e for e in segundo["linhas"][0]["erros"])
    assert cliente.post(f"{URL}/{lote['id']}/confirmar").status_code == 400


def test_desfazer_lote(cliente, revisor, licania):
    lote = enviar(cliente.como(revisor), CSV).json()
    cliente.post(f"{URL}/{lote['id']}/confirmar")
    assert cliente.post(f"{URL}/{lote['id']}/desfazer", {}, format="json").status_code == 400
    r = cliente.post(f"{URL}/{lote['id']}/desfazer", {"motivo": "Arquivo errado"}, format="json")
    assert r.status_code == 200, r.json()
    assert r.json()["estado"] == "desfeito"
    assert Arvore.objects.count() == 0
    assert IdentificadorExterno.objects.count() == 0


def test_desfazer_bloqueado_apos_edicao(cliente, revisor, licania):
    lote = enviar(cliente.como(revisor), CSV).json()
    cliente.post(f"{URL}/{lote['id']}/confirmar")
    arvore = Arvore.objects.first()
    cliente.patch(f"/api/v1/arvores/{arvore.id}", {"endereco": "Corrigido"}, format="json")
    detalhe = cliente.get(URL).json()["results"][0]
    assert detalhe["pode_desfazer"] is False
    assert "alteradas" in detalhe["motivo_nao_desfazer"]
    r = cliente.post(f"{URL}/{lote['id']}/desfazer", {"motivo": "x"}, format="json")
    assert r.status_code == 400


def test_geojson_e_reprojecao(cliente, revisor):
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "G1"},
                "geometry": {"type": "Point", "coordinates": [-38.555, -3.755]},
            },
        ],
    }
    lote = enviar(
        cliente.como(revisor),
        json.dumps(geojson),
        nome="a.geojson",
        campo_latitude="",
        campo_longitude="",
        campo_id_externo="id",
    ).json()
    assert lote["linhas_validas"] == 1

    utm = "id,x,y\nU1,550000,9585000\n"  # SIRGAS 2000 / UTM 24S
    lote = enviar(
        cliente,
        utm,
        campo_latitude="y",
        campo_longitude="x",
        campo_id_externo="id",
        campo_especie="",
        campo_altura="",
        campo_dap="",
        campo_endereco="",
        srid=31984,
    ).json()
    dados = lote["linhas"][0]["dados"]
    assert -38.6 < dados["longitude"] < -38.4 and -3.9 < dados["latitude"] < -3.6


def test_arquivo_invalido(cliente, revisor):
    r = enviar(cliente.como(revisor), "{nao é json", nome="a.geojson")
    assert r.status_code == 400
    r = enviar(cliente, "x", nome="a.xlsx")
    assert r.status_code == 400


def test_importacao_exige_permissao(cliente, tecnico_a):
    assert enviar(cliente.como(tecnico_a), CSV).status_code == 403
