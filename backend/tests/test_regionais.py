"""Equivalência das regionais entre o CKAN e o Fortaleza em Mapas (F-03).

``fortaleza_em_mapas_bairros_regionais.json`` tem os 121 bairros reais do mapa 21 (nome,
regional atual, regional antiga e código da região), e ``ckan_regionais_bairros.json``, as 12
regionais e os 121 bairros do CKAN (KMZ ``regionais-atuais`` e ``bairros_2025``), ambos obtidos
em 2026-11-12 sem alteração. Nenhum teste usa rede.
"""

import json
import unicodedata
from pathlib import Path

import pytest
from django.core.management import call_command

from itree.territorio.models import Territorio
from itree.territorio.regionais import (
    EQUIVALENCIA,
    ROMANOS,
    numero_da_regional,
    regional_por_codigo_ckan,
    regional_por_numero,
)

DADOS = Path(__file__).parent / "dados"
BAIRROS_MAPAS = json.loads((DADOS / "fortaleza_em_mapas_bairros_regionais.json").read_text())
CKAN = json.loads((DADOS / "ckan_regionais_bairros.json").read_text())
REGIONAIS = str(DADOS / "fortaleza_em_mapas_regionais_trecho.geojson")
BAIRROS = str(DADOS / "fortaleza_em_mapas_bairros_trecho.geojson")
CODIGO_REGIAO = "Código da  Região"


def _chave(nome: str) -> str:
    sem = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode()
    return " ".join(sem.casefold().split())


# --- A tabela contra o dado real ----------------------------------------------


def test_tabela_tem_as_12_regionais_sem_repeticao():
    assert [r.numero for r in EQUIVALENCIA] == list(range(1, 13))
    assert [r.ckan_nome for r in EQUIVALENCIA] == ROMANOS
    assert len({r.codigo for r in EQUIVALENCIA}) == 12
    assert {r.codigo for r in EQUIVALENCIA} == set(ROMANOS)


def test_codigo_nao_e_o_numero_em_romano():
    """A armadilha das fontes: a SER 8 tem o código VI e a SER 6, o código VIII."""
    assert regional_por_numero(8).codigo == "VI" and regional_por_numero(8).ckan_nome == "VIII"
    assert regional_por_numero(6).codigo == "VIII" and regional_por_numero(6).ckan_nome == "VI"
    assert regional_por_numero(12).codigo == "I"


def test_bate_com_os_121_bairros_do_fortaleza_em_mapas():
    """Em todo bairro real, o código da região é o da regional atual."""
    assert len(BAIRROS_MAPAS) == 121
    for b in BAIRROS_MAPAS:
        regional = regional_por_numero(numero_da_regional(b["Regional Atual"]))
        assert regional is not None, b["Nome"]
        assert regional.codigo == b[CODIGO_REGIAO], b["Nome"]


def test_bate_com_os_poligonos_das_regionais_do_ckan():
    """O nome do polígono é o número em romano e o campo Regional é o código."""
    assert len(CKAN["regionais"]) == 12
    for r in CKAN["regionais"]:
        porcodigo = regional_por_codigo_ckan(r["Regional"])
        assert porcodigo is not None and porcodigo.ckan_nome == r["name"], r


def test_bate_com_os_bairros_do_ckan_e_do_mapas_pelo_nome():
    mapas = {
        _chave(b["Nome"]): regional_por_numero(numero_da_regional(b["Regional Atual"]))
        for b in BAIRROS_MAPAS
    }
    comparados = 0
    for b in CKAN["bairros"]:
        regional = mapas.get(_chave(b["bairro"]))
        if regional is None:  # nome escrito de outro jeito nas duas fontes
            continue
        comparados += 1
        assert regional.codigo == b["novas_regionais"], b["bairro"]
    assert comparados >= 115  # só "Rachel de Queiroz" e "Boa Vista / Castelão" não casam pelo nome


def test_o_numero_da_regional_aceita_os_formatos_das_fontes():
    assert numero_da_regional("Secretaria Executiva Regional 8") == 8
    assert numero_da_regional("SER 08") == 8  # podas da URBFOR
    assert numero_da_regional(" SER 1 ") == 1
    assert numero_da_regional("SER 13") is None and numero_da_regional("SERCE") is None
    assert numero_da_regional(None) is None
    assert regional_por_codigo_ckan(" vi ").numero == 8
    assert regional_por_codigo_ckan("XIII") is None and regional_por_codigo_ckan("") is None


# --- Usada na importação de limites ----------------------------------------------


def _importar(regionais=REGIONAIS, bairros=BAIRROS):
    from io import StringIO

    saida = StringIO()
    call_command(
        "importar_limites_fortaleza",
        arquivo_regionais=regionais,
        arquivo_bairros=bairros,
        permitir_contagem_diferente=True,
        stdout=saida,
    )
    return saida.getvalue()


def _com_bairros(tmp_path, alterar):
    dados = json.loads(Path(BAIRROS).read_text())
    for f in dados["features"]:
        alterar(f["properties"])
    arquivo = tmp_path / "bairros.geojson"
    arquivo.write_text(json.dumps(dados))
    return str(arquivo)


@pytest.mark.django_db
def test_importacao_grava_a_equivalencia_na_regional_e_no_bairro():
    saida = _importar()
    ser12 = Territorio.objects.get(tipo="regional", codigo="12")
    assert ser12.metadados["ckan_nome"] == "XII" and ser12.metadados["ckan_codigo"] == "I"
    centro = Territorio.objects.get(tipo="bairro", nome="Centro")
    assert centro.metadados["codigo_regiao_ckan"] == "I" and centro.pai == ser12
    assert "diferente do esperado" not in saida and "fora da tabela" not in saida


@pytest.mark.django_db
def test_bairro_sem_regional_atual_e_ligado_pelo_codigo_da_regiao(tmp_path):
    def sem_atual(p):
        p["Regional Atual"] = None

    saida = _importar(bairros=_com_bairros(tmp_path, sem_atual))
    ser12 = Territorio.objects.get(tipo="regional", codigo="12")
    assert {b.pai for b in Territorio.objects.filter(tipo="bairro")} == {ser12}
    assert "2 bairro(s) ligados à regional pelo código da região" in saida


@pytest.mark.django_db
def test_sem_regional_atual_e_com_codigo_desconhecido_o_bairro_vai_ao_municipio(tmp_path):
    def sem_nada(p):
        p["Regional Atual"] = None
        p[CODIGO_REGIAO] = "XIII"

    saida = _importar(bairros=_com_bairros(tmp_path, sem_nada))
    municipio = Territorio.objects.get(tipo="municipio")
    assert {b.pai for b in Territorio.objects.filter(tipo="bairro")} == {municipio}
    assert "2 bairro(s) sem regional reconhecida" in saida


@pytest.mark.django_db
def test_codigo_da_regiao_divergente_e_avisado_e_a_regional_atual_prevalece(tmp_path):
    def codigo_errado(p):
        if p["Nome"] == "Centro":
            p[CODIGO_REGIAO] = "VIII"  # seria o da SER 6

    saida = _importar(bairros=_com_bairros(tmp_path, codigo_errado))
    ser12 = Territorio.objects.get(tipo="regional", codigo="12")
    assert Territorio.objects.get(tipo="bairro", nome="Centro").pai == ser12
    assert "1 bairro(s) com código da região diferente do esperado" in saida
    assert "Centro: SER 12, código da região VIII" in saida


@pytest.mark.django_db
def test_regional_fora_da_tabela_e_avisada(tmp_path):
    dados = json.loads(Path(REGIONAIS).read_text())
    dados["features"][0]["properties"]["regiao_adm"] = "SER 13"
    arquivo = tmp_path / "regionais.geojson"
    arquivo.write_text(json.dumps(dados))
    saida = _importar(regionais=str(arquivo))
    assert "1 regional(is) fora da tabela de equivalência (SER 1 a 12): SER 13" in saida
