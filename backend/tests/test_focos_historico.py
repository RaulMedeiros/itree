"""Backfill mensal dos focos de calor do INPE (``ingerir_focos_historico``).

``dados/focos_mensal_inpe_202301_trecho.csv`` reúne linhas literais do arquivo real
``focos_mensal_br_202301`` (baixado em 2026-11-11): o cabeçalho, 2 focos da Bahia,
3 de Fortaleza e 2 de Caucaia (Ceará) e 2 do Maranhão, entre eles o de "Fortaleza
dos Nogueiras", que só um filtro por estado separa de Fortaleza. Nenhum teste usa a rede.
"""

import io
import zipfile
from pathlib import Path

import pytest
import responses
from django.contrib.gis.geos import MultiPolygon, Polygon
from django.core.management import call_command
from django.core.management.base import CommandError

from itree.alertas import fontes
from itree.alertas.management.commands.ingerir_focos_historico import meses_entre
from itree.alertas.models import AlertaAmbiental, IngestaoAlertas
from itree.notificacoes.models import Notificacao

from .conftest import com_escopo, criar_territorio, criar_usuario

pytestmark = pytest.mark.django_db

TRECHO = (Path(__file__).parent / "dados" / "focos_mensal_inpe_202301_trecho.csv").read_bytes()
BASE = "https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/mensal/Brasil/"
FORTALEZA = {
    "757fab54-5b5b-30bc-a6d5-b93ffd103e14",
    "39516737-e8e1-3624-a8e6-4907cd3cb6c9",
    "9c1465cf-01be-3e59-b172-f5964ec38c9b",
}


def _zip(conteudo: bytes, nome="focos_mensal_br_202301.csv") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(nome, conteudo)
    return buf.getvalue()


@pytest.fixture
def fortaleza(db):
    return criar_territorio(
        "Fortaleza",
        tipo="municipio",
        geom=MultiPolygon(Polygon.from_bbox((-38.65, -3.9, -38.40, -3.68)), srid=4326),
    )


def _servir_zip_de_2023():
    responses.get(BASE + "focos_mensal_br_202301.zip", body=_zip(TRECHO))


# --- Leitura em fluxo e filtro por estado ---------------------------------------


def test_filtra_pelo_estado_sem_confundir_fortaleza_dos_nogueiras():
    linhas = TRECHO.decode().splitlines()
    registros, invalidos, lidas = fontes.ler_focos_em_fluxo(linhas, "Ceará")
    assert (lidas, invalidos) == (9, 0)
    assert len(registros) == 5
    assert {r.propriedades["estado"] for r in registros} == {"CEARÁ"}
    assert FORTALEZA <= {r.id_externo for r in registros}


def test_registros_so_sao_montados_para_o_estado_escolhido(monkeypatch):
    montados = []
    original = fontes._registro_foco
    monkeypatch.setattr(
        fontes, "_registro_foco", lambda linha: montados.append(linha) or original(linha)
    )
    fontes.ler_focos_em_fluxo(TRECHO.decode().splitlines(), "ceara")
    assert len(montados) == 5  # as outras 4 linhas nem chegam a virar registro


def test_sem_estado_le_tudo_e_exige_a_coluna_quando_filtra():
    registros, _, lidas = fontes.ler_focos_em_fluxo(TRECHO.decode().splitlines())
    assert (len(registros), lidas) == (9, 9)
    with pytest.raises(fontes.ErroFonte, match="coluna 'estado'"):
        fontes.ler_focos_em_fluxo(["id,lat,lon,data_hora_gmt", "1,-3.7,-38.5,2023-01-01"], "Ceará")


def test_urls_do_mes_zip_ate_2023_e_csv_depois():
    assert fontes.urls_focos_mensal(2023, 1) == [
        BASE + "focos_mensal_br_202301.zip",
        BASE + "focos_mensal_br_202301.csv",
    ]
    assert fontes.urls_focos_mensal(2024, 12)[0] == BASE + "focos_mensal_br_202412.csv"


def test_meses_atravessam_a_virada_do_ano():
    assert meses_entre((2023, 11), (2024, 2)) == [(2023, 11), (2023, 12), (2024, 1), (2024, 2)]
    assert meses_entre((2023, 5), (2023, 5)) == [(2023, 5)]


# --- Comando ---------------------------------------------------------------------


@responses.activate
def test_backfill_de_um_mes_zip_ingere_so_o_ceara_dentro_do_municipio(fortaleza, capsys):
    _servir_zip_de_2023()
    call_command("ingerir_focos_historico", desde="2023-01", ate="2023-01")
    assert set(AlertaAmbiental.objects.values_list("id_externo", flat=True)) == FORTALEZA
    ingestao = IngestaoAlertas.objects.get()
    assert ingestao.sucesso, ingestao.erro
    # Ceará: 5 (3 de Fortaleza e 2 de Caucaia, fora do município); o resto nem foi lido.
    assert (ingestao.recebidos, ingestao.novos, ingestao.fora_do_municipio) == (5, 3, 2)
    assert ingestao.origem == BASE + "focos_mensal_br_202301.zip"
    assert ingestao.orgao == "INPE, Programa Queimadas" and "DP-" not in ingestao.licenca
    saida = capsys.readouterr().out
    assert "2023-01: 9 focos no Brasil, 5 em Ceará: 3 novos" in saida


@responses.activate
def test_backfill_e_idempotente(fortaleza):
    _servir_zip_de_2023()
    call_command("ingerir_focos_historico", desde="2023-01", ate="2023-01")
    call_command("ingerir_focos_historico", desde="2023-01", ate="2023-01")
    assert AlertaAmbiental.objects.count() == 3
    segunda = IngestaoAlertas.objects.first()
    assert (segunda.novos, segunda.ja_existentes) == (0, 3)


@responses.activate
def test_backfill_a_partir_de_2024_le_o_csv_direto(fortaleza):
    responses.get(BASE + "focos_mensal_br_202401.csv", body=TRECHO)
    call_command("ingerir_focos_historico", desde="2024-01", ate="2024-01")
    assert AlertaAmbiental.objects.count() == 3
    assert [c.request.url for c in responses.calls] == [BASE + "focos_mensal_br_202401.csv"]


@responses.activate
def test_backfill_tenta_a_outra_extensao_quando_a_primeira_nao_existe(fortaleza):
    responses.get(BASE + "focos_mensal_br_202301.zip", status=404)
    responses.get(BASE + "focos_mensal_br_202301.csv", body=TRECHO)
    call_command("ingerir_focos_historico", desde="2023-01", ate="2023-01")
    assert AlertaAmbiental.objects.count() == 3
    assert IngestaoAlertas.objects.get().origem.endswith(".csv")


@responses.activate
def test_varios_meses_seguem_adiante_e_o_que_falhou_vira_erro_do_comando(fortaleza):
    _servir_zip_de_2023()
    responses.get(BASE + "focos_mensal_br_202302.zip", status=404)
    responses.get(BASE + "focos_mensal_br_202302.csv", status=404)
    with pytest.raises(CommandError, match=r"1 mês\(es\) com falha: 2023-02"):
        call_command("ingerir_focos_historico", desde="2023-01", ate="2023-02")
    assert AlertaAmbiental.objects.count() == 3  # janeiro entrou
    falha = IngestaoAlertas.objects.get(sucesso=False)
    assert falha.erro and falha.orgao == "INPE, Programa Queimadas"


@responses.activate
def test_backfill_nao_notifica_ninguem(fortaleza, django_capture_on_commit_callbacks):
    com_escopo(criar_usuario("g@itree.teste", ["gestor"]), fortaleza)
    _servir_zip_de_2023()
    with django_capture_on_commit_callbacks(execute=True):
        call_command("ingerir_focos_historico", desde="2023-01", ate="2023-01")
    assert AlertaAmbiental.objects.count() == 3 and Notificacao.objects.count() == 0
    # O dia a dia continua avisando.
    AlertaAmbiental.objects.all().delete()
    with django_capture_on_commit_callbacks(execute=True):
        fontes.ingerir("inpe_focos", TRECHO, "dia.csv")
    assert Notificacao.objects.count() == 1


@pytest.mark.parametrize(
    ("desde", "ate", "mensagem"),
    [
        ("2023-13", "2023-14", "Mês inválido"),
        ("2023/01", "2023-02", "Use AAAA-MM"),
        ("2023-03", "2023-01", "não pode ser posterior"),
    ],
)
def test_periodo_invalido_gera_erro_claro(desde, ate, mensagem):
    with pytest.raises(CommandError, match=mensagem):
        call_command("ingerir_focos_historico", desde=desde, ate=ate)
