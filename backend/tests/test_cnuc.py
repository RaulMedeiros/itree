"""Conferência das unidades de conservação com o CNUC (AV-03).

Os arquivos de ``tests/dados`` são trechos do dado real, sem alteração:
``cnuc_2026_07_trecho.csv`` tem as linhas do CNUC (MMA, 2026-07) das unidades que abrangem
Fortaleza, uma unidade do Rio de Janeiro com "Fortaleza" no nome e uma do Ceará fora de
Fortaleza; ``fortaleza_em_mapas_737_uc_nomes.json`` tem as 18 feições reais do mapa 737.
Nenhum teste usa rede.
"""

import io
import json
from pathlib import Path

import pytest
import responses
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from itree.areas_verdes.cnuc import CnucInvalido, chave_da_uc, conferir, ler_cnuc
from itree.areas_verdes.management.commands.conferir_ucs_cnuc import URL_CNUC
from itree.areas_verdes.models import AreaVerde

from .conftest import com_escopo, criar_territorio, criar_usuario, quadrado

pytestmark = pytest.mark.django_db

DADOS = Path(__file__).parent / "dados"
CNUC = DADOS / "cnuc_2026_07_trecho.csv"
UCS_MAPA = DADOS / "fortaleza_em_mapas_737_uc_nomes.json"
UCS_COM_GEOMETRIA = str(DADOS / "fortaleza_em_mapas_737_uc.json")
URL = "/api/v1/areas-verdes"

# Código do CNUC de cada unidade do mapa que casa (nome da fonte da prefeitura).
CASADAS = {
    "APA do Rio Maranguapinho": ("0000.23.4278", "Estadual"),
    "ARIE do Sítio Curió": ("0000.23.1932", "Estadual"),
    "Parque Estadual do Cocó": ("0000.23.0963", "Estadual"),
    "Parque Estadual Marinho da Pedra da Risca do Meio - ZA": ("0000.23.0947", "Estadual"),
    "Parque Estadual Marinho da Pedra da Risca do Meio - ZP": ("0000.23.0947", "Estadual"),
    "Parque Estadual Marinho da Pedra da Risca do Meio - ZC": ("0000.23.0947", "Estadual"),
    "ARIE do Cambeba": ("0000.23.3807", "Estadual"),
    "APA da Lagoa da Precabura": ("0000.23.4867", "Estadual"),
    "APA do Estuário do Rio Ceará": ("0000.23.0951", "Estadual"),
    "APA do Rio Pacoti": ("0000.23.0959", "Estadual"),
    "APA da Lagoa da Maraponga": ("0440.23.3900", "Municipal"),
    "Parque Natural Municipal das Dunas de Sabiaguaba": ("0440.23.3295", "Municipal"),
}
SEM_CORRESPONDENTE = {"APA da Sabiaguaba", "ARIE Prof. Abreu Matos", "ARIE da Matinha do Pici"}


def _ucs_do_mapa():
    """As 18 feições reais do mapa 737, com um quadrado no lugar da geometria."""
    agora = timezone.now()
    for f in json.loads(UCS_MAPA.read_text()):
        AreaVerde.objects.create(
            tipo="unidade_conservacao",
            nome=f["Nome"],
            codigo_externo=str(f["id"]),
            esfera=f["Esfera"],
            area_m2=f["Área  (m²)"],
            geom=quadrado(-38.6 + f["id"] * 0.01, -3.8, 0.005),
            fonte="Fortaleza em Mapas",
            ingerido_em=agora,
        )


def _conferir(*args, **opts):
    saida = io.StringIO()
    call_command("conferir_ucs_cnuc", *args, arquivo=str(CNUC), stdout=saida, **opts)
    return saida.getvalue()


# --- Nome normalizado ---------------------------------------------------------


@pytest.mark.parametrize(
    ("mapa", "cnuc"),
    [  # pares reais: nome da prefeitura x nome do CNUC
        ("APA do Rio Maranguapinho", "ÁREA DE PROTEÇÃO AMBIENTAL DO RIO MARANGUAPINHO"),
        ("ARIE do Sítio Curió", "ÁREA DE RELEVANTE INTERESSE ECOLÓGICO DO SÍTIO CURIÓ"),
        ("Parque Estadual do Cocó", "PARQUE ESTADUAL DO COCÓ"),
        (
            "Parque Estadual Marinho da Pedra da Risca do Meio - ZP",
            "PARQUE ESTADUAL MARINHO DA PEDRA DA RISCA DO MEIO",
        ),
        (  # "de" no mapa, "da" no CNUC
            "Parque Natural Municipal das Dunas de Sabiaguaba",
            "PARQUE NATURAL MUNICIPAL DAS DUNAS DA SABIAGUABA",
        ),
        ("APA da Lagoa da Maraponga", "ÁREA DE PROTEÇÃO AMBIENTAL  DA LAGOA DA MARAPONGA"),
    ],
)
def test_chave_da_uc_iguala_os_nomes_das_duas_fontes(mapa, cnuc):
    assert chave_da_uc(mapa) == chave_da_uc(cnuc)


def test_chave_da_uc_nao_iguala_unidades_diferentes():
    assert chave_da_uc("APA da Sabiaguaba") != chave_da_uc(
        "PARQUE NATURAL MUNICIPAL DAS DUNAS DA SABIAGUABA"
    )
    assert chave_da_uc("ARIE do Cambeba") != chave_da_uc("APA do Cambeba")
    assert chave_da_uc("") == ""


def test_ler_cnuc_filtra_a_uf_e_confere_as_colunas():
    ce = ler_cnuc(CNUC.read_bytes(), "CE")
    assert len(ce) == 11 and all("FORTALEZA DE SANTA CRUZ" not in uc.nome for uc in ce)
    assert [uc.nome for uc in ler_cnuc(CNUC.read_bytes(), "RJ")] == [
        "ÁREA DE PROTEÇÃO AMBIENTAL DA FORTALEZA DE SANTA CRUZ E DOS FORTES DO PICO E DO RIO BRANCO"
    ]
    assert any(uc.codigo == "0000.23.0951" and uc.esfera == "Estadual" for uc in ce)
    with pytest.raises(CnucInvalido, match="Colunas ausentes"):
        ler_cnuc(b"a;b\n1;2\n")


# --- Comando ------------------------------------------------------------------


def test_grava_codigo_e_esfera_nas_unidades_que_casam():
    _ucs_do_mapa()
    _conferir()
    gravadas = {
        a.nome: (a.codigo_cnuc, a.esfera_cnuc) for a in AreaVerde.objects.exclude(codigo_cnuc="")
    }
    assert gravadas == CASADAS
    # As 4 feições da APA do Estuário e as 3 zonas do Parque Marinho repetem o código.
    assert AreaVerde.objects.filter(codigo_cnuc="0000.23.0951").count() == 4
    assert AreaVerde.objects.filter(codigo_cnuc="0000.23.0947").count() == 3
    assert AreaVerde.objects.filter(cnuc_conferido_em__isnull=False).count() == 4 + 3 + 8
    sem = AreaVerde.objects.filter(codigo_cnuc="")
    assert {a.nome for a in sem} == SEM_CORRESPONDENTE
    assert all(a.esfera_cnuc == "" and a.cnuc_conferido_em is None for a in sem)


def test_relatorio_lista_as_nao_casadas():
    _ucs_do_mapa()
    saida = _conferir()
    assert "10 unidade(s) casada(s) com o CNUC (15 de 18 feições)" in saida
    assert "3 unidade(s) do mapa sem correspondente no CNUC" in saida
    for nome in SEM_CORRESPONDENTE:
        assert f"  {nome} (1 feição(ões))" in saida
    assert "  APA do Estuário do Rio Ceará -> 0000.23.0951 (Estadual), 4 feição(ões)" in saida
    # A unidade do RJ com "Fortaleza" no nome nunca entra (UF do CNUC).
    assert "Santa Cruz" not in saida


def test_nao_troca_a_esfera_da_fonte_e_avisa_da_divergencia():
    _ucs_do_mapa()
    AreaVerde.objects.filter(nome="ARIE do Cambeba").update(esfera="Municipal")
    saida = _conferir()
    cambeba = AreaVerde.objects.get(nome="ARIE do Cambeba")
    assert cambeba.esfera == "Municipal" and cambeba.esfera_cnuc == "Estadual"
    assert "Esfera diferente: ARIE do Cambeba: mapa Municipal, CNUC Estadual" in saida


def test_simular_nao_grava():
    _ucs_do_mapa()
    saida = _conferir(simular=True)
    assert "Simulação: nada foi gravado" in saida
    assert not AreaVerde.objects.exclude(codigo_cnuc="").exists()


def test_reexecutar_e_idempotente_e_refaz_o_cruzamento():
    _ucs_do_mapa()
    _conferir()
    primeira = {a.pk: a.cnuc_conferido_em for a in AreaVerde.objects.exclude(codigo_cnuc="")}
    _conferir()
    assert {
        a.pk: a.cnuc_conferido_em for a in AreaVerde.objects.exclude(codigo_cnuc="")
    } == primeira
    # Quem deixa de casar perde o código (a unidade saiu do CNUC).
    AreaVerde.objects.filter(nome="APA do Rio Pacoti").update(nome="APA do Rio Inexistente")
    _conferir()
    pacoti = AreaVerde.objects.get(nome="APA do Rio Inexistente")
    assert (pacoti.codigo_cnuc, pacoti.esfera_cnuc, pacoti.cnuc_conferido_em) == ("", "", None)


def test_so_confere_unidades_de_conservacao():
    AreaVerde.objects.create(
        tipo="parque",
        nome="Parque Estadual do Cocó",
        geom=quadrado(-38.5, -3.8, 0.01),
        fonte="Teste",
        ingerido_em=timezone.now(),
    )
    _conferir()
    assert AreaVerde.objects.get().codigo_cnuc == ""


def test_unidade_do_cnuc_no_municipio_que_o_mapa_nao_traz():
    _ucs_do_mapa()
    AreaVerde.objects.filter(nome="APA do Rio Pacoti").delete()
    saida = _conferir()
    assert "No CNUC em Fortaleza e fora do mapa de unidades:" in saida
    assert "ÁREA DE PROTEÇÃO AMBIENTAL DO RIO PACOTI (0000.23.0959, Estadual)" in saida


def test_nome_ambiguo_no_cnuc_nao_e_casado():
    ucs = ler_cnuc(CNUC.read_bytes(), "CE")
    repetida = next(uc for uc in ucs if uc.codigo == "0000.23.0963")
    ucs.append(type(repetida)("0000.23.9999", repetida.nome, "Federal", "Parque", "FORTALEZA (CE)"))
    area = AreaVerde(nome="Parque Estadual do Cocó", esfera="Estadual")
    resultado = conferir([area], ucs)
    assert resultado.casadas == {}
    assert resultado.ambiguas == {"Parque Estadual do Cocó": ["0000.23.0963", "0000.23.9999"]}


def test_reimportar_as_areas_verdes_preserva_o_codigo_do_cnuc():
    call_command("importar_areas_verdes", arquivo=UCS_COM_GEOMETRIA, tipo="unidade_conservacao")
    _conferir()
    estuario = AreaVerde.objects.filter(nome="APA do Estuário do Rio Ceará")
    assert {a.codigo_cnuc for a in estuario} == {"0000.23.0951"}
    call_command("importar_areas_verdes", arquivo=UCS_COM_GEOMETRIA, tipo="unidade_conservacao")
    assert {a.codigo_cnuc for a in estuario} == {"0000.23.0951"}
    assert {a.esfera_cnuc for a in estuario} == {"Estadual"}


def test_erros_claros(tmp_path):
    ruim = tmp_path / "ruim.csv"
    ruim.write_text("a;b\n1;2\n")
    with pytest.raises(CommandError, match="Colunas ausentes"):
        call_command("conferir_ucs_cnuc", arquivo=str(ruim))
    with pytest.raises(CommandError, match="Não foi possível obter"):
        call_command("conferir_ucs_cnuc", arquivo=str(tmp_path / "nao_existe.csv"))


@responses.activate
def test_baixa_o_csv_pela_url_do_mma():
    _ucs_do_mapa()
    responses.get(URL_CNUC, body=CNUC.read_bytes())
    call_command("conferir_ucs_cnuc", stdout=io.StringIO())
    assert [c.request.url for c in responses.calls] == [URL_CNUC]
    assert AreaVerde.objects.filter(codigo_cnuc="0000.23.0951").count() == 4


@responses.activate
def test_falha_do_download_nao_grava_nada():
    _ucs_do_mapa()
    responses.get(URL_CNUC, status=503)
    with pytest.raises(CommandError, match="Não foi possível obter"):
        call_command("conferir_ucs_cnuc")
    assert not AreaVerde.objects.exclude(codigo_cnuc="").exists()


# --- API: feições da mesma unidade agrupadas ------------------------------------


def _usuario():
    mundo = criar_territorio("Mundo", tipo="municipio", geom=quadrado(-39, -4.5, 3))
    return com_escopo(criar_usuario("cnuc@itree.teste", ["gestor"]), mundo)


def _propriedades(resposta):
    assert resposta.status_code == 200
    return [f["properties"] for f in resposta.json()["features"]]


def test_api_agrupa_as_feicoes_da_mesma_unidade(cliente):
    _ucs_do_mapa()
    _conferir()
    props = _propriedades(cliente.como(_usuario()).get(URL, {"tipo": "unidade_conservacao"}))
    estuario = [p for p in props if p["nome"] == "APA do Estuário do Rio Ceará"]
    assert len(estuario) == 4
    for p in estuario:
        assert p["feicoes_da_unidade"] == 4
        assert p["area_total_da_unidade_m2"] == pytest.approx(
            26945928.66 + 22818.88 + 79834.17 + 301345.4
        )
        assert (p["codigo_cnuc"], p["esfera_cnuc"]) == ("0000.23.0951", "Estadual")
    marinho = [p for p in props if p["nome"].startswith("Parque Estadual Marinho")]
    assert {p["feicoes_da_unidade"] for p in marinho} == {3}
    cambeba = next(p for p in props if p["nome"] == "ARIE do Cambeba")
    assert cambeba["feicoes_da_unidade"] == 1 and cambeba["area_total_da_unidade_m2"] == 110143.59


def test_api_agrupa_pelo_nome_mesmo_sem_conferir_o_cnuc(cliente):
    _ucs_do_mapa()
    props = _propriedades(cliente.como(_usuario()).get(URL, {"tipo": "unidade_conservacao"}))
    assert {p["feicoes_da_unidade"] for p in props if p["nome"].startswith("APA do Estuário")} == {
        4
    }
    assert {p["codigo_cnuc"] for p in props} == {""}


def test_api_so_conta_feicoes_do_escopo_e_nao_agrupa_outros_tipos(cliente):
    _ucs_do_mapa()
    AreaVerde.objects.create(
        tipo="parque",
        nome="Parque Estadual do Cocó",
        geom=quadrado(-38.5, -3.8, 0.01),
        fonte="Teste",
        ingerido_em=timezone.now(),
    )
    c = cliente.como(_usuario())
    parque = _propriedades(c.get(URL, {"tipo": "parque"}))[0]
    assert parque["feicoes_da_unidade"] is None and parque["area_total_da_unidade_m2"] is None
    # Escopo curto: só uma das 4 feições da APA do Estuário fica visível.
    uma = AreaVerde.objects.filter(nome="APA do Estuário do Rio Ceará").first()
    x, y = uma.geom.centroid.coords
    curto = com_escopo(
        criar_usuario("curto@itree.teste", ["gestor"]),
        criar_territorio("Quadra", geom=quadrado(x - 0.001, y - 0.001, 0.002)),
    )
    props = _propriedades(cliente.como(curto).get(URL, {"tipo": "unidade_conservacao"}))
    assert [p["nome"] for p in props] == ["APA do Estuário do Rio Ceará"]
    assert props[0]["feicoes_da_unidade"] == 1


def test_detalhe_traz_o_agrupamento(cliente):
    _ucs_do_mapa()
    _conferir()
    uma = AreaVerde.objects.filter(nome="APA do Estuário do Rio Ceará").first()
    corpo = cliente.como(_usuario()).get(f"{URL}/{uma.id}").json()
    assert corpo["properties"]["feicoes_da_unidade"] == 4
    assert corpo["properties"]["codigo_cnuc"] == "0000.23.0951"
