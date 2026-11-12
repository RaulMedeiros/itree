"""Fontes públicas reais (docs/integracoes/fontes-publicas.md).

Os arquivos de ``tests/dados`` são trechos pequenos de dados verdadeiros,
verificados em 2026-11-11: Fortaleza em Mapas (ids 17 e 21) e INPE, Programa
Queimadas. Nenhum teste acessa a rede.
"""

from datetime import UTC, date, datetime
from pathlib import Path

import pytest
import responses
from django.contrib.gis.geos import MultiPolygon, Polygon
from django.core.management import call_command
from django.core.management.base import CommandError

from itree.alertas import fontes
from itree.alertas.models import AlertaAmbiental, IngestaoAlertas
from itree.alertas.tasks import ingerir_fontes_configuradas
from itree.territorio.models import Territorio

from .conftest import criar_territorio

pytestmark = pytest.mark.django_db

DADOS = Path(__file__).parent / "dados"
REGIONAIS = str(DADOS / "fortaleza_em_mapas_regionais_trecho.geojson")
BAIRROS = str(DADOS / "fortaleza_em_mapas_bairros_trecho.geojson")
FOCOS_REAIS = (DADOS / "focos_inpe_trecho.csv").read_bytes()


def importar(**extras):
    call_command(
        "importar_limites_fortaleza",
        arquivo_regionais=REGIONAIS,
        arquivo_bairros=BAIRROS,
        permitir_contagem_diferente=True,
        **extras,
    )


# --- Limites oficiais de Fortaleza ----------------------------------------------


def test_importa_regional_e_bairros_com_hierarquia_e_proveniencia():
    importar()
    municipio = Territorio.objects.get(tipo="municipio")
    regional = Territorio.objects.get(tipo="regional")
    assert (municipio.nome, regional.nome, regional.codigo) == ("Fortaleza", "SER 12", "12")
    assert regional.pai == municipio
    bairros = Territorio.objects.filter(tipo="bairro")
    assert set(bairros.values_list("nome", "codigo")) == {
        ("Centro", "2304400010"),
        ("Praia de Iracema", "2304400032"),
    }
    # Bairros ligados à regional atual informada pela fonte.
    assert {b.pai for b in bairros} == {regional}
    assert regional.geom.geom_type == "MultiPolygon" and regional.geom.srid == 4326

    centro = bairros.get(nome="Centro")
    assert "Fortaleza em Mapas (Ipplan Fortaleza)" in centro.fonte
    assert centro.fonte_url == "https://mapas.fortaleza.ce.gov.br/mapa/21/bairros-de-fortaleza"
    assert centro.licenca == "Uso livre com citação da fonte (termos da API)"
    assert centro.data_referencia == date(2022, 11, 13)
    assert centro.ingerido_em is not None
    assert centro.metadados["regional_atual"] == "Secretaria Executiva Regional 12"
    assert centro.metadados["src_original"] == 31984
    assert regional.data_referencia == date(2020, 1, 1)
    assert regional.metadados["data_referencia_precisao"] == "ano"


def test_codigo_do_bairro_e_o_codigo_do_ibge_com_dois_espacos():
    importar()
    codigos = set(Territorio.objects.filter(tipo="bairro").values_list("codigo", flat=True))
    assert all(c.startswith("23044000") and len(c) == 10 for c in codigos)


def test_reimportar_e_idempotente_e_atualiza_geometria_e_proveniencia():
    importar()
    centro = Territorio.objects.get(tipo="bairro", nome="Centro")
    Territorio.objects.filter(pk=centro.pk).update(
        nome="Antigo", licenca="x", geom=MultiPolygon(Polygon.from_bbox((0, 0, 1, 1)), srid=4326)
    )
    importar()
    assert Territorio.objects.count() == 4  # município, 1 regional, 2 bairros
    atual = Territorio.objects.get(pk=centro.pk)
    assert atual.nome == "Centro"
    assert atual.licenca.startswith("Uso livre")
    assert atual.geom.area < 0.01  # geometria restaurada da fonte


def test_municipio_existente_e_reaproveitado():
    existente = criar_territorio("Fortaleza", tipo="municipio")
    importar()
    assert Territorio.objects.filter(tipo="municipio").count() == 1
    assert Territorio.objects.get(tipo="regional").pai == existente


def test_contagem_diferente_da_esperada_exige_confirmacao():
    with pytest.raises(CommandError, match="esperadas 12"):
        call_command(
            "importar_limites_fortaleza", arquivo_regionais=REGIONAIS, arquivo_bairros=BAIRROS
        )
    assert Territorio.objects.count() == 0


def test_arquivo_invalido_gera_erro_claro(tmp_path):
    ruim = tmp_path / "x.geojson"
    ruim.write_text("não é json")
    with pytest.raises(CommandError, match="Não foi possível ler"):
        call_command("importar_limites_fortaleza", arquivo_regionais=str(ruim))


@responses.activate
def test_sem_arquivo_busca_a_api_do_fortaleza_em_mapas():
    base = "https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id="
    responses.get(base + "17", body=Path(REGIONAIS).read_text(encoding="utf-8"))
    responses.get(base + "21", body=Path(BAIRROS).read_text(encoding="utf-8"))
    call_command("importar_limites_fortaleza", permitir_contagem_diferente=True)
    assert Territorio.objects.filter(tipo="bairro").count() == 2
    centro = Territorio.objects.get(tipo="bairro", nome="Centro")
    assert centro.metadados["origem"] == base + "21"


# --- Focos de calor diários do INPE ---------------------------------------------


def test_ler_focos_csv_com_o_formato_real_do_inpe():
    registros, invalidos = fontes.ler_focos_csv(FOCOS_REAIS)
    assert (len(registros), invalidos) == (5, 0)
    primeiro = registros[0]
    # Valores reais vêm com espaços à esquerda ("  -1.036700").
    assert primeiro.id_externo == "d93d4984-535b-369b-a048-8e593b1dbd46"
    assert (primeiro.geom.x, primeiro.geom.y) == (-53.5575, -1.0367)
    assert primeiro.data_deteccao == datetime(2026, 11, 9, 0, 0, tzinfo=UTC)
    assert primeiro.propriedades["satelite"] == "GOES-19"
    assert primeiro.propriedades["bioma"] == "Amazônia"


def test_ingestao_filtra_pelo_municipio_do_escopo_e_registra_licenca():
    # Município de Fortaleza real (união da regional do trecho) não cobre os focos
    # de 2023 fora do trecho; usa-se um retângulo grosseiro de Fortaleza.
    criar_territorio(
        "Fortaleza",
        tipo="municipio",
        geom=MultiPolygon(Polygon.from_bbox((-38.65, -3.9, -38.40, -3.68)), srid=4326),
    )
    r = fontes.ingerir("inpe_focos", FOCOS_REAIS, "focos_inpe_trecho.csv")
    assert r.sucesso, r.erro
    # 2 focos reais em Fortaleza (jan/2023); 3 fora, inclusive o de Fortaleza dos Nogueiras (MA).
    assert (r.recebidos, r.novos, r.fora_do_municipio) == (5, 2, 3)
    assert set(AlertaAmbiental.objects.values_list("id_externo", flat=True)) == {
        "757fab54-5b5b-30bc-a6d5-b93ffd103e14",
        "39516737-e8e1-3624-a8e6-4907cd3cb6c9",
    }
    assert r.orgao == "INPE, Programa Queimadas"
    assert "Não declarada" in r.licenca and "DP-" not in r.licenca
    assert r.data_referencia == date(2026, 11, 9)
    # Idempotência por UUID do foco.
    r2 = fontes.ingerir("inpe_focos", FOCOS_REAIS, "focos_inpe_trecho.csv")
    assert (r2.novos, r2.ja_existentes) == (0, 2)


# --- Marcadores de data na URL --------------------------------------------------

URL_INPE = (
    "https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/"
    "focos_diario_br_{data}.csv"
)


def test_resolver_url_usa_o_dia_anterior_no_fuso_de_fortaleza():
    # 2026-11-10 01:30 em Fortaleza (UTC-3) ainda é 2026-11-10 04:30 UTC.
    agora = datetime(2026, 11, 10, 4, 30, tzinfo=UTC)
    assert fontes.resolver_url(URL_INPE, agora).endswith("focos_diario_br_20261109.csv")
    assert fontes.resolver_url("x/{data_hoje}/{data}", agora) == "x/20261110/20261109"


def test_resolver_url_nao_usa_a_data_utc():
    # 2026-11-10 01:00 UTC ainda é 2026-11-09 22:00 em Fortaleza: o dia anterior é 08.
    agora = datetime(2026, 11, 10, 1, 0, tzinfo=UTC)
    assert fontes.resolver_url("{data}|{data_hoje}", agora) == "20261108|20261109"


def test_resolver_url_sem_marcador_nao_muda():
    assert fontes.resolver_url("https://fonte.teste/a.csv") == "https://fonte.teste/a.csv"


@responses.activate
def test_tarefa_periodica_resolve_o_marcador_e_grava_a_origem(settings):
    criar_territorio(
        "Fortaleza",
        tipo="municipio",
        geom=MultiPolygon(Polygon.from_bbox((-38.65, -3.9, -38.40, -3.68)), srid=4326),
    )
    settings.ALERTAS_FONTES = {"inpe_focos": "https://fonte.teste/focos_{data}.csv"}
    ontem = fontes.resolver_url("{data}")
    responses.get(f"https://fonte.teste/focos_{ontem}.csv", body=FOCOS_REAIS)
    resultado = ingerir_fontes_configuradas()
    assert resultado == [{"fonte": "inpe_focos", "sucesso": True, "novos": 2}]
    ingestao = IngestaoAlertas.objects.get()
    assert ingestao.origem == f"https://fonte.teste/focos_{ontem}.csv"
    assert ingestao.orgao == "INPE, Programa Queimadas"


@responses.activate
def test_falha_de_download_tambem_registra_orgao_e_licenca(settings):
    settings.ALERTAS_FONTES = {"inpe_focos": "https://fonte.teste/focos_{data}.csv"}
    responses.get(f"https://fonte.teste/focos_{fontes.resolver_url('{data}')}.csv", status=404)
    resultado = ingerir_fontes_configuradas()
    assert resultado[0]["sucesso"] is False
    ingestao = IngestaoAlertas.objects.get()
    assert "Não declarada" in ingestao.licenca
