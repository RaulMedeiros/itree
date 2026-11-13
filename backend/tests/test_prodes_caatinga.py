"""PRODES Caatinga como camada de referência histórica (F-02).

``dados/prodes_caatinga_yearly_deforestation_trecho.geojson`` reúne 8 feições literais da
resposta real do WFS do TerraBrasilis (``prodes-caatinga-nb:yearly_deforestation``, consultada
em 2026-11-13 para o retângulo de Fortaleza): anos de 2004 a 2021, com a chave ``image_date``.
Nenhum teste usa a rede.
"""

import json
from pathlib import Path

import pytest
import responses
from django.contrib.gis.geos import MultiPolygon, Polygon
from django.core.management import call_command
from django.core.management.base import CommandError

from itree.alertas import fontes, prodes
from itree.alertas.models import AlertaAmbiental, SupressaoAnual

from .conftest import com_escopo, criar_territorio, criar_usuario

pytestmark = pytest.mark.django_db

ARQUIVO = Path(__file__).parent / "dados" / "prodes_caatinga_yearly_deforestation_trecho.geojson"
# Município de teste: x de -38,60 a -38,50 e y de -3,90 a -3,70. Dentro dele ficam as feições de
# 2018 e 2021; a de 2013 fica a ~2,8 km a oeste, outra de 2013 a ~3,4 km a leste e as demais, longe.
MUNICIPIO = (-38.60, -3.90, -38.50, -3.70)


@pytest.fixture
def municipio(db):
    geom = MultiPolygon(Polygon.from_bbox(MUNICIPIO), srid=4326)
    return criar_territorio("Fortaleza", tipo="municipio", geom=geom)


def _anos():
    return sorted(SupressaoAnual.objects.values_list("ano", flat=True))


def test_le_a_data_da_chave_image_date_da_fonte_real():
    registros, invalidos = fontes.ler_geojson(ARQUIVO.read_bytes(), prodes.FONTE_LEITURA)
    assert invalidos == 0 and len(registros) == 8
    por_ano = {r.propriedades["year"]: r for r in registros}
    assert por_ano[2021].data_deteccao.date().isoformat() == "2021-07-23"
    assert por_ano[2018].data_deteccao.date().isoformat() == "2018-06-13"
    assert por_ano[2021].id_externo == por_ano[2021].propriedades["uuid"]


def test_comando_ingere_so_o_recorte_com_buffer_configuravel(municipio, capsys):
    call_command("ingerir_prodes_caatinga", arquivo=str(ARQUIVO), buffer_km=0)
    assert _anos() == [2018, 2021]
    call_command("ingerir_prodes_caatinga", arquivo=str(ARQUIVO), buffer_km=3)
    # Com 3 km entra também a feição de 2013, a ~2,8 km do limite (a outra, a ~3,4 km, não).
    assert _anos() == [2013, 2018, 2021]
    assert "Nenhum alerta foi criado" in capsys.readouterr().out


def test_buffer_padrao_vem_da_configuracao(municipio, settings):
    settings.PRODES_CAATINGA_BUFFER_KM = 3
    call_command("ingerir_prodes_caatinga", arquivo=str(ARQUIVO))
    assert _anos() == [2013, 2018, 2021]


def test_e_camada_de_referencia_nao_gera_alerta(municipio):
    call_command("ingerir_prodes_caatinga", arquivo=str(ARQUIVO), buffer_km=0)
    assert AlertaAmbiental.objects.count() == 0


def test_grava_ano_data_da_imagem_area_e_proveniencia(municipio):
    call_command("ingerir_prodes_caatinga", arquivo=str(ARQUIVO), buffer_km=0)
    s = SupressaoAnual.objects.get(ano=2021)
    assert s.data_imagem.isoformat() == "2021-07-23"
    assert s.area_ha == pytest.approx(10.03, abs=0.01)  # area_km da fonte x 100
    assert s.satelite == "landsat8"
    assert "INPE" in s.fonte and "TerraBrasilis" in s.fonte
    assert "Não declarada" in s.licenca and s.fonte_url.startswith("https://")
    assert s.geom.geom_type == "MultiPolygon" and s.geom.srid == 4326


def test_reingerir_e_idempotente(municipio):
    call_command("ingerir_prodes_caatinga", arquivo=str(ARQUIVO), buffer_km=0)
    area = prodes.recorte(0)
    resumo = prodes.ingerir(ARQUIVO.read_bytes(), area)
    assert (resumo.novos, resumo.atualizados) == (0, 2)
    assert SupressaoAnual.objects.count() == 2


def test_sem_municipio_o_comando_explica():
    with pytest.raises(CommandError, match="município"):
        call_command("ingerir_prodes_caatinga", arquivo=str(ARQUIVO))


def test_url_do_wfs_usa_a_camada_e_o_retangulo_do_recorte(municipio):
    url = prodes.url_do_recorte(prodes.recorte(0))
    assert "typeNames=prodes-caatinga-nb:yearly_deforestation" in url
    assert "outputFormat=application/json" in url
    # WFS 2.0 com EPSG:4326 pede latitude antes de longitude.
    assert "bbox=-3.9,-38.6,-3.7,-38.5,urn:ogc:def:crs:EPSG::4326" in url


@responses.activate
def test_baixa_repetindo_quando_o_servidor_responde_503(municipio, monkeypatch):
    monkeypatch.setattr(prodes.time, "sleep", lambda s: None)
    url = prodes.url_do_recorte(prodes.recorte(0))
    responses.add(responses.GET, prodes.URL_WFS, status=503)
    responses.add(responses.GET, prodes.URL_WFS, body=ARQUIVO.read_bytes())
    call_command("ingerir_prodes_caatinga", buffer_km=0)
    assert len(responses.calls) == 2 and responses.calls[0].request.url.startswith(url[:60])
    assert _anos() == [2018, 2021]


def _gestor(municipio):
    return com_escopo(criar_usuario("g@itree.teste", ["gestor"]), municipio)


def test_api_devolve_a_camada_com_ano_escala_e_fonte(municipio, cliente):
    call_command("ingerir_prodes_caatinga", arquivo=str(ARQUIVO), buffer_km=0)
    r = cliente.como(_gestor(municipio)).get("/api/v1/mapa/supressao-anual")
    assert r.status_code == 200
    corpo = r.json()
    assert sorted(f["properties"]["ano"] for f in corpo["features"]) == [2018, 2021]
    prov = corpo["proveniencia"]
    assert (prov["ano_inicial"], prov["ano_final"], prov["quantidade"]) == (2018, 2021, 2)
    assert "escala regional" in prov["escala"] and "1 ha" in prov["escala"]
    assert "TerraBrasilis" in prov["fonte"] and prov["licenca"]
    assert json.dumps(corpo["features"][0]["geometry"])


def test_api_respeita_o_escopo_e_a_permissao(municipio, cliente, settings):
    settings.PRODES_CAATINGA_BUFFER_KM = 0
    call_command("ingerir_prodes_caatinga", arquivo=str(ARQUIVO), buffer_km=0)
    # Bairro que cobre só o canto da feição de 2018: a de 2021 fica fora do escopo.
    bairro = criar_territorio(
        "Bairro Norte",
        geom=MultiPolygon(Polygon.from_bbox((-38.60, -3.82, -38.50, -3.70)), srid=4326),
    )
    tecnico = com_escopo(criar_usuario("t@itree.teste", ["gestor"]), bairro)
    corpo = cliente.como(tecnico).get("/api/v1/mapa/supressao-anual").json()
    assert [f["properties"]["ano"] for f in corpo["features"]] == [2018]
    sem_permissao = com_escopo(criar_usuario("s@itree.teste", []), municipio)
    assert cliente.como(sem_permissao).get("/api/v1/mapa/supressao-anual").status_code == 403
