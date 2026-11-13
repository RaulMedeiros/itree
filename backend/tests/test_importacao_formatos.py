"""Formatos de importação além de CSV e GeoJSON: XLSX, Shapefile em ZIP, GeoPackage, KML e KMZ
(RF-INV-015). Os arquivos geográficos são gerados aqui, com a ogr2ogr da GDAL, em pastas
temporárias do teste."""

import io
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from openpyxl import Workbook

from itree.inventario.models import Arvore

from .conftest import com_escopo, criar_usuario

pytestmark = pytest.mark.django_db

URL = "/api/v1/importacoes"


def feicoes(*itens, geometria="Point"):
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"cod": cod, "especie": especie},
                "geometry": {"type": geometria, "coordinates": coords},
            }
            for cod, especie, coords in itens
        ],
    }


PONTOS = feicoes(
    ("G1", "Licania tomentosa", [-38.555, -3.755]),
    ("G2", "Ipê", [-38.556, -3.756]),
)
QUADRADO = [
    [
        [-38.5552, -3.7552],
        [-38.5548, -3.7552],
        [-38.5548, -3.7548],
        [-38.5552, -3.7548],
        [-38.5552, -3.7552],
    ]
]


def ogr2ogr(tmp_path: Path, dados: dict, driver: str, nome: str, *extras: str) -> Path:
    """Converte um GeoJSON em ``driver`` com a ogr2ogr; falha (não pula) se ela não existir."""
    binario = shutil.which("ogr2ogr")
    assert binario, "ogr2ogr (gdal-bin) é necessária para gerar os arquivos de teste"
    origem = tmp_path / "origem.geojson"
    origem.write_text(json.dumps(dados))
    destino = tmp_path / nome
    subprocess.run(  # noqa: S603 - argumentos fixos do teste
        [binario, "-f", driver, str(destino), str(origem), *extras],
        check=True,
        capture_output=True,
    )
    return destino


def zipar(pasta: Path, nomes=None) -> bytes:
    saida = io.BytesIO()
    with zipfile.ZipFile(saida, "w") as z:
        for arquivo in sorted(pasta.iterdir()):
            if nomes is None or arquivo.suffix in nomes:
                z.write(arquivo, arquivo.name)
    return saida.getvalue()


def enviar(cliente, conteudo: bytes, nome: str, **campos):
    dados = {
        "arquivo": SimpleUploadedFile(nome, conteudo),
        "fonte": "Fonte geográfica",
        "campo_id_externo": "cod",
        "campo_especie": "especie",
        **campos,
    }
    return cliente.post(URL, dados, format="multipart")


def validas(lote):
    return {
        linha["dados"].get("id_externo"): linha["dados"]
        for linha in lote["linhas"]
        if not linha["erros"]
    }


def test_xlsx_com_numeros_nativos(cliente, revisor):
    planilha = Workbook()
    aba = planilha.active
    aba.append(["codigo", "lat", "lon", "altura", "rua"])
    aba.append(["X1", -3.755, -38.555, 8.5, "Rua A"])
    aba.append([None, None, None, None, None])  # linha vazia é ignorada
    aba.append(["X2", -3.756, -38.556, None, "Rua B"])
    arquivo = io.BytesIO()
    planilha.save(arquivo)

    r = enviar(
        cliente.como(revisor),
        arquivo.getvalue(),
        "inventario.xlsx",
        campo_latitude="lat",
        campo_longitude="lon",
        campo_id_externo="codigo",
        campo_altura="altura",
        campo_endereco="rua",
    )
    assert r.status_code == 201, r.json()
    lote = r.json()
    assert (lote["formato"], lote["total_linhas"], lote["linhas_validas"]) == ("xlsx", 2, 2)
    dados = validas(lote)
    assert dados["X1"]["altura"] == "8.5" and dados["X1"]["endereco"] == "Rua A"
    assert dados["X2"]["latitude"] == -3.756


def test_xlsx_exige_colunas_de_coordenadas_e_aparece_em_colunas(cliente, revisor):
    planilha = Workbook()
    planilha.active.append(["codigo", "lat", "lon"])
    planilha.active.append(["X1", -3.755, -38.555])
    arquivo = io.BytesIO()
    planilha.save(arquivo)
    cliente.como(revisor)
    r = enviar(cliente, arquivo.getvalue(), "a.xlsx")
    assert r.status_code == 400 and "campo_latitude" in r.json()
    r = cliente.post(
        f"{URL}/colunas",
        {"arquivo": SimpleUploadedFile("a.xlsx", arquivo.getvalue())},
        format="multipart",
    )
    assert r.status_code == 200
    assert r.json()["colunas"] == ["codigo", "lat", "lon"] and r.json()["total_linhas"] == 1


def test_shapefile_zip_reprojeta_do_src_do_arquivo(cliente, revisor, tmp_path):
    pasta = tmp_path / "shp"
    pasta.mkdir()
    ogr2ogr(pasta, PONTOS, "ESRI Shapefile", "arvores.shp", "-t_srs", "EPSG:31984")
    # O SRC do .prj (UTM) vale; o 4326 informado só serve a arquivo sem SRC.
    r = enviar(cliente.como(revisor), zipar(pasta), "arvores.zip", srid=4326)
    assert r.status_code == 201, r.json()
    lote = r.json()
    assert (lote["formato"], lote["linhas_validas"]) == ("shapefile", 2)
    g1 = validas(lote)["G1"]
    assert g1["longitude"] == pytest.approx(-38.555, abs=1e-5)
    assert g1["latitude"] == pytest.approx(-3.755, abs=1e-5)
    assert g1["especie_texto"] == "Licania tomentosa"


def test_shapefile_sem_prj_usa_o_src_informado(cliente, revisor, tmp_path):
    pasta = tmp_path / "shp"
    pasta.mkdir()
    ogr2ogr(pasta, PONTOS, "ESRI Shapefile", "arvores.shp", "-t_srs", "EPSG:31984")
    zip_sem_prj = zipar(pasta, nomes={".shp", ".shx", ".dbf"})

    # Sem SRC no arquivo e com 4326 informado, os metros viram graus inválidos.
    r = enviar(cliente.como(revisor), zip_sem_prj, "arvores.zip", srid=4326)
    assert r.json()["linhas_validas"] == 0
    assert any("fora do intervalo" in e for e in r.json()["linhas"][0]["erros"])

    r = enviar(cliente, zip_sem_prj, "arvores.zip", srid=31984)
    assert r.json()["linhas_validas"] == 2
    assert validas(r.json())["G1"]["longitude"] == pytest.approx(-38.555, abs=1e-5)


def test_shapefile_ignora_nomes_de_membros_e_lixo_do_zip(cliente, revisor, tmp_path):
    pasta = tmp_path / "shp"
    pasta.mkdir()
    ogr2ogr(pasta, PONTOS, "ESRI Shapefile", "arvores.shp")
    saida = io.BytesIO()
    with zipfile.ZipFile(saida, "w") as z:
        for arquivo in pasta.iterdir():
            # Caminhos hostis: só a extensão importa, o destino é sempre um nome nosso.
            z.write(arquivo, f"../../{arquivo.name}")
        z.writestr("__MACOSX/._arvores.shp", b"lixo")
        z.writestr("leia-me.txt", "ignorado")
    r = enviar(cliente.como(revisor), saida.getvalue(), "arvores.zip")
    assert r.status_code == 201, r.json()
    assert r.json()["linhas_validas"] == 2
    assert not (tmp_path.parent / "arvores.shp").exists()


def test_zip_sem_shapefile_ou_corrompido(cliente, revisor):
    cliente.como(revisor)
    saida = io.BytesIO()
    with zipfile.ZipFile(saida, "w") as z:
        z.writestr("dados.csv", "a,b")
    r = enviar(cliente, saida.getvalue(), "x.zip")
    assert r.status_code == 400 and "Shapefile" in r.json()["arquivo"]
    assert enviar(cliente, b"isto nao e zip", "x.zip").status_code == 400
    assert enviar(cliente, b"isto nao e gpkg", "x.gpkg").status_code == 400


def test_zip_respeita_limites_de_membros_e_de_tamanho(cliente, revisor, settings):
    cliente.como(revisor)
    saida = io.BytesIO()
    with zipfile.ZipFile(saida, "w") as z:
        for i in range(4):
            z.writestr(f"m{i}.dbf", b"x" * 100)
    settings.IMPORTACAO_MAX_MEMBROS_ZIP = 3
    r = enviar(cliente, saida.getvalue(), "x.zip")
    assert r.status_code == 400 and "limite é 3" in r.json()["arquivo"]

    settings.IMPORTACAO_MAX_MEMBROS_ZIP = 50
    settings.IMPORTACAO_MAX_DESCOMPACTADO_MB = 0
    r = enviar(cliente, saida.getvalue(), "x.zip")
    assert r.status_code == 400 and "descompactado" in r.json()["arquivo"]


def test_tamanho_maximo_do_arquivo(cliente, revisor, settings):
    settings.IMPORTACAO_TAMANHO_MAXIMO_MB = 0
    r = enviar(cliente.como(revisor), b"cod,lat,lon\n", "a.csv")
    assert r.status_code == 400 and "limite de 0 MB" in r.json()["arquivo"]


def test_geopackage(cliente, revisor, tmp_path):
    caminho = ogr2ogr(tmp_path, PONTOS, "GPKG", "arvores.gpkg")
    r = enviar(cliente.como(revisor), caminho.read_bytes(), "arvores.gpkg")
    assert r.status_code == 201, r.json()
    assert (r.json()["formato"], r.json()["linhas_validas"]) == ("geopackage", 2)
    assert validas(r.json())["G2"]["especie_texto"] == "Ipê"


def test_kml_e_kmz(cliente, revisor, tmp_path):
    caminho = ogr2ogr(tmp_path, PONTOS, "KML", "arvores.kml")
    cliente.como(revisor)
    r = enviar(cliente, caminho.read_bytes(), "arvores.kml")
    assert r.status_code == 201, r.json()
    assert (r.json()["formato"], r.json()["linhas_validas"]) == ("kml", 2)

    saida = io.BytesIO()
    with zipfile.ZipFile(saida, "w") as z:
        z.write(caminho, "doc.kml")
    r = enviar(cliente, saida.getvalue(), "arvores.kmz")
    assert r.status_code == 201, r.json()
    assert (r.json()["formato"], r.json()["linhas_validas"]) == ("kmz", 2)
    assert enviar(cliente, saida.getvalue(), "sem_kml.kmz").status_code == 201
    vazio = io.BytesIO()
    with zipfile.ZipFile(vazio, "w") as z:
        z.writestr("leia-me.txt", "nada")
    assert enviar(cliente, vazio.getvalue(), "vazio.kmz").status_code == 400


def test_colunas_de_arquivo_geografico_indicam_geometria(cliente, revisor, tmp_path):
    caminho = ogr2ogr(tmp_path, PONTOS, "GPKG", "arvores.gpkg")
    r = cliente.como(revisor).post(
        f"{URL}/colunas",
        {"arquivo": SimpleUploadedFile("arvores.gpkg", caminho.read_bytes())},
        format="multipart",
    )
    assert r.status_code == 200, r.json()
    assert r.json()["colunas"] == ["cod", "especie"]
    assert r.json()["tem_geometria"] is True and r.json()["total_linhas"] == 2


def test_poligonos_sao_recusados_com_mensagem_clara(cliente, revisor, tmp_path):
    caminho = ogr2ogr(
        tmp_path, feicoes(("P1", "", QUADRADO), geometria="Polygon"), "GPKG", "copas.gpkg"
    )
    r = enviar(cliente.como(revisor), caminho.read_bytes(), "copas.gpkg")
    assert r.status_code == 201, r.json()
    assert r.json()["linhas_validas"] == 0
    erro = r.json()["linhas"][0]["erros"][0]
    assert "polígono" in erro and "só pontos" in erro and "ponto interior" in erro


def test_poligono_entra_pelo_ponto_interior_so_se_pedido(cliente, revisor, tmp_path):
    caminho = ogr2ogr(
        tmp_path, feicoes(("P1", "", QUADRADO), geometria="Polygon"), "GPKG", "copas.gpkg"
    )
    r = enviar(
        cliente.como(revisor), caminho.read_bytes(), "copas.gpkg", usar_ponto_interior="true"
    )
    assert r.status_code == 201, r.json()
    lote = r.json()
    assert lote["linhas_validas"] == 1 and lote["usar_ponto_interior"] is True
    dados = validas(lote)["P1"]
    assert dados["longitude"] == pytest.approx(-38.555, abs=1e-4)
    assert dados["latitude"] == pytest.approx(-3.755, abs=1e-4)
    assert cliente.post(f"{URL}/{lote['id']}/confirmar").status_code == 200
    assert Arvore.objects.get().origem_registro == "importacao"


def test_geopackage_com_varias_camadas_pede_uma_so(cliente, revisor, tmp_path):
    caminho = ogr2ogr(tmp_path, PONTOS, "GPKG", "dois.gpkg")
    origem = tmp_path / "origem.geojson"
    subprocess.run(  # noqa: S603 - argumentos fixos do teste
        [shutil.which("ogr2ogr"), "-f", "GPKG", "-append", str(caminho), str(origem), "-nln", "b"],
        check=True,
        capture_output=True,
    )
    r = enviar(cliente.como(revisor), caminho.read_bytes(), "dois.gpkg")
    assert r.status_code == 400 and "camadas" in r.json()["arquivo"]


def test_geografico_respeita_o_escopo_territorial(cliente, territorios, tmp_path):
    so_a = com_escopo(
        criar_usuario("so_a@itree.teste", ["revisor"], registro_profissional="CREA 1"),
        territorios["a"],
    )
    fora = feicoes(("F1", "", [-38.535, -3.755]), ("F2", "", [-38.555, -3.755]))  # B e A
    caminho = ogr2ogr(tmp_path, fora, "GPKG", "arvores.gpkg")
    r = enviar(cliente.como(so_a), caminho.read_bytes(), "arvores.gpkg")
    linhas = {linha["dados"]["id_externo"]: linha for linha in r.json()["linhas"]}
    assert linhas["F1"]["erros"] == ["Fora do seu escopo territorial."]
    assert linhas["F2"]["erros"] == []


def test_formatos_novos_exigem_permissao(cliente, tecnico_a, tmp_path):
    caminho = ogr2ogr(tmp_path, PONTOS, "GPKG", "arvores.gpkg")
    assert enviar(cliente.como(tecnico_a), caminho.read_bytes(), "arvores.gpkg").status_code == 403
