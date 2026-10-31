import json

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from itree.contas.acesso import filtrar_por_escopo
from itree.contas.models import EscopoUsuario
from itree.territorio.models import Territorio

from .conftest import criar_territorio, criar_usuario, quadrado

pytestmark = pytest.mark.django_db


def _geojson_utm(tmp_path, nome="bairros.geojson", com_src=True):
    """Dois bairros em SIRGAS 2000 / UTM 24S (EPSG:31984), perto de Fortaleza."""

    def ret(x, y):
        return [[[x, y], [x + 1000, y], [x + 1000, y + 1000], [x, y + 1000], [x, y]]]

    dados = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"NOME": "Centro", "COD": 1},
                "geometry": {"type": "Polygon", "coordinates": ret(552000, 9585000)},
            },
            {
                "type": "Feature",
                "properties": {"NOME": "Benfica", "COD": 2},
                "geometry": {"type": "MultiPolygon", "coordinates": [ret(553000, 9585000)]},
            },
        ],
    }
    if com_src:
        dados["crs"] = {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::31984"}}
    caminho = tmp_path / nome
    caminho.write_text(json.dumps(dados))
    return str(caminho)


def _importar(arquivo, **extras):
    call_command(
        "importar_territorios",
        arquivo,
        tipo="bairro",
        campo_nome="NOME",
        campo_codigo="COD",
        fonte="Fonte de teste",
        data_referencia="2024-05-01",
        **extras,
    )


def test_importa_reprojetando_e_mantendo_proveniencia(tmp_path):
    _importar(_geojson_utm(tmp_path), municipio="Fortaleza")
    centro = Territorio.objects.get(tipo="bairro", codigo="1")
    assert centro.geom.srid == 4326
    x, y = centro.geom.centroid.coords
    assert -38.6 < x < -38.4 and -3.8 < y < -3.7
    assert centro.metadados["src_original"] == 31984
    assert centro.fonte == "Fonte de teste"
    assert str(centro.data_referencia) == "2024-05-01"

    municipio = Territorio.objects.get(tipo="municipio")
    assert municipio.nome == "Fortaleza"
    assert set(municipio.filhos.values_list("nome", flat=True)) == {"Centro", "Benfica"}
    assert municipio.geom.contains(centro.geom.point_on_surface)


def test_reimportar_e_idempotente(tmp_path):
    arquivo = _geojson_utm(tmp_path)
    _importar(arquivo)
    _importar(arquivo)
    assert Territorio.objects.filter(tipo="bairro").count() == 2


def test_arquivo_inexistente_gera_erro_claro(tmp_path):
    with pytest.raises(CommandError, match="Não foi possível abrir"):
        _importar(str(tmp_path / "inexistente.geojson"))


def test_endpoint_geojson_inclui_proveniencia(cliente, gestor):
    criar_territorio("Meireles")
    resposta = cliente.como(gestor).get("/api/v1/territorios/geojson", {"tipo": "bairro"})
    assert resposta.status_code == 200
    feicao = resposta.json()["features"][0]
    assert feicao["geometry"]["type"] == "MultiPolygon"
    assert feicao["properties"]["fonte"] == "Teste"
    assert "ingerido_em" in feicao["properties"]


def test_lista_de_territorios(cliente, gestor):
    criar_territorio("Meireles")
    criar_territorio("Fortaleza", tipo="municipio")
    corpo = cliente.como(gestor).get("/api/v1/territorios", {"tipo": "bairro"}).json()
    assert [t["nome"] for t in corpo["results"]] == ["Meireles"]


def test_filtro_por_escopo_territorial():
    """RF-ACL-003: registros fora do escopo não aparecem; sem escopo, nada."""
    a = criar_territorio("A", geom=quadrado(0, 0, 1))
    criar_territorio("B", geom=quadrado(5, 5, 1))
    usuario = criar_usuario("e@itree.teste", ["gestor"])

    def visiveis():
        return set(
            filtrar_por_escopo(Territorio.objects.all(), usuario).values_list("nome", flat=True)
        )

    assert visiveis() == set()
    EscopoUsuario.objects.create(usuario=usuario, territorio=a)
    assert visiveis() == {"A"}

    grande = criar_territorio("Município", tipo="municipio", geom=quadrado(-1, -1, 10))
    EscopoUsuario.objects.create(usuario=usuario, territorio=grande)
    assert visiveis() == {"A", "B", "Município"}


def test_auditoria_resume_geometria(cliente, admin, tmp_path):
    _importar(_geojson_utm(tmp_path))
    eventos = (
        cliente.como(admin)
        .get("/api/v1/admin/auditoria", {"entidade": "territorio.TerritorioEvent"})
        .json()["results"]
    )
    assert eventos and all(e["dados"]["geom"] == "(geometria)" for e in eventos)
    assert eventos[0]["contexto"]["evento"] == "importacao_territorios"
