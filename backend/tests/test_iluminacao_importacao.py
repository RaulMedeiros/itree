"""Importação dos pontos de iluminação pública (SEINF): agregação, SRC, descartes e faixa de altura."""

from datetime import date

import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.core.management.base import CommandError
from openpyxl import Workbook

from itree.iluminacao import importacao
from itree.iluminacao.models import LoteIluminacao, PontoIluminacao

from .conftest import PONTO_A

pytestmark = pytest.mark.django_db

CABECALHO = [
    "CÓDIGO_DE_PONTO_DE_SERVIÇO",
    "PONTO_DE_SERVIÇO_X",
    "PONTE_DE_SERVIÇO_Y",
    "REGIÃO",
    "NATUREZA_LOGRADOURO",
    "DESIGNAÇÃO_LOGRADOURO",
    "DESIGNAÇÃO_BAIRRO",
    "POSTE",
    "LÂMPADA",
    "POTÊNCIA_NOMINAL",
    "POTÊNCIA_CONSUMIDA",
    "FAMILIA_LÂMPADA",
]


def utm(longitude, latitude):
    """Coordenadas SIRGAS 2000 / UTM 24S (31984) de um ponto em WGS 84, como a fonte as traz."""
    p = Point(longitude, latitude, srid=4326).transform(31984, clone=True)
    return round(p.x, 2), round(p.y, 2)


def linha(codigo, x, y, poste="CONCRETO DUPLO T DE 5 A 10 M", lampada="SODIO 400 W", **extras):
    return [
        codigo,
        x,
        y,
        "REGIONAL II  ",
        "AV         ",
        extras.get("logradouro", "HERACLITO GRACA, AV  "),
        extras.get("bairro", "ALDEOTA        "),
        poste,
        lampada,
        400,
        454,
        "SÓDIO        ",
    ]


def planilha(tmp_path, linhas, nome="ilum.xlsx", aba="CREXPORT", cabecalho=CABECALHO):
    livro = Workbook()
    ws = livro.active
    ws.title = aba
    ws.append(cabecalho)
    for item in linhas:
        ws.append(item)
    caminho = tmp_path / nome
    livro.save(caminho)
    return caminho


def importar(caminho, **opts):
    call_command("importar_iluminacao_publica", arquivo=str(caminho), **opts)


# Em Fortaleza, perto da Aldeota (o ponto 904705 da fonte real).
ALDEOTA = (554469.75, 9586805.0)


def test_agrega_as_linhas_por_ponto_e_converte_o_src(tmp_path):
    caminho = planilha(
        tmp_path,
        [
            linha(904705, *ALDEOTA),
            linha(904705, *ALDEOTA, lampada="LED 100 W"),
            linha(904706, ALDEOTA[0] + 30, ALDEOTA[1] + 10),
        ],
    )
    importar(caminho)
    assert PontoIluminacao.objects.count() == 2
    ponto = PontoIluminacao.objects.get(codigo="904705")
    assert [la["tipo"] for la in ponto.lampadas] == ["SODIO 400 W", "LED 100 W"]
    assert ponto.lampadas[0]["potencia_nominal_w"] == 400
    assert ponto.lampadas[0]["potencia_consumida_w"] == 454
    assert ponto.lampadas[0]["familia"] == "SÓDIO"
    # 4326 de verdade: a Aldeota fica em torno de (-38,5; -3,74), não em metros UTM.
    assert ponto.geom.srid == 4326
    assert -38.52 < ponto.geom.x < -38.48 and -3.76 < ponto.geom.y < -3.72
    volta = ponto.geom.transform(31984, clone=True)
    assert volta.x == pytest.approx(ALDEOTA[0], abs=0.05)
    assert volta.y == pytest.approx(ALDEOTA[1], abs=0.05)
    # Textos sem os espaços à direita da fonte.
    assert ponto.regional == "REGIONAL II"
    assert ponto.logradouro == "HERACLITO GRACA, AV"
    assert ponto.bairro_fonte == "ALDEOTA"


def test_registra_o_lote_com_fonte_licenca_url_e_data(tmp_path):
    importar(planilha(tmp_path, [linha(1, *ALDEOTA), linha(1, *ALDEOTA)]))
    lote = LoteIluminacao.objects.get()
    assert "SEINF" in lote.fonte
    assert "CC BY-SA" in lote.licenca
    assert lote.fonte_url == importacao.URL_OFICIAL
    assert lote.data_referencia == date(2022, 11, 16)
    assert (lote.linhas_lidas, lote.pontos_importados) == (2, 1)
    assert len(lote.arquivo_sha256) == 64
    assert PontoIluminacao.objects.get().lote == lote


def test_descarta_e_conta_ponto_sem_coordenada_invalido_e_fora_do_municipio(tmp_path, capsys):
    longe = utm(-39.50, -4.50)  # fora de Fortaleza (caixa do município)
    caminho = planilha(
        tmp_path,
        [
            linha(1, *ALDEOTA),
            linha(2, "         ", "         "),  # célula em branco, como a fonte
            linha(3, None, None),
            linha(4, "abc", "9586805"),  # texto no lugar de número
            linha(5, 5.0, 5.0),  # fora da faixa do SRC
            linha(6, *longe),
            linha(0, "   ", "   "),  # o "ponto 0" da fonte real, sem coordenada
        ],
    )
    importar(caminho)
    assert list(PontoIluminacao.objects.values_list("codigo", flat=True)) == ["1"]
    lote = LoteIluminacao.objects.get()
    assert (lote.sem_coordenada, lote.coordenada_invalida, lote.fora_do_municipio) == (3, 2, 1)
    saida = capsys.readouterr().out
    assert "1 ponto(s) importado(s)" in saida
    assert "3 ponto(s) descartado(s) sem coordenada" in saida
    assert "1 ponto(s) descartado(s) fora do município" in saida


def test_fora_do_limite_oficial_do_municipio_e_descartado(tmp_path, territorios):
    # O município de teste é um quadrado em (-38,60; -3,80) a (-38,40; -3,60): a Aldeota cai fora
    # dele só se o limite oficial for usado; aqui o ponto do Bairro A cai dentro.
    dentro = utm(PONTO_A["longitude"], PONTO_A["latitude"])
    fora = utm(-38.65, -3.75)  # dentro da caixa folgada, fora do quadrado de teste
    importar(planilha(tmp_path, [linha(1, *dentro), linha(2, *fora)]))
    assert list(PontoIluminacao.objects.values_list("codigo", flat=True)) == ["1"]
    assert LoteIluminacao.objects.get().fora_do_municipio == 1


def test_resolve_o_bairro_oficial_pela_geometria(tmp_path, territorios):
    dentro_de_a = utm(PONTO_A["longitude"], PONTO_A["latitude"])
    importar(planilha(tmp_path, [linha(1, *dentro_de_a, bairro="BAIRRO ERRADO")]))
    ponto = PontoIluminacao.objects.get()
    assert ponto.bairro == territorios["a"]
    assert ponto.bairro_fonte == "BAIRRO ERRADO"  # o texto da fonte fica como veio


@pytest.mark.parametrize(
    ("poste", "tipo", "minima", "maxima"),
    [
        ("CONCRETO DUPLO T DE 5 A 10 M", "CONCRETO DUPLO T", 5, 10),
        ("CONCRETO REDONDO DE 11 A 14 M", "CONCRETO REDONDO", 11, 14),
        ("FIBRA DE VIDRO REDONDO DE 11M A 14M", "FIBRA DE VIDRO REDONDO", 11, 14),
        ("CONCRETO REDONDO DE 18 A 25M", "CONCRETO REDONDO", 18, 25),
        ("SUPORTE ATÉ 5 M", "SUPORTE", None, 5),
        ("AÇO ENGASTADO REDONDO ATÉ 5 M", "AÇO ENGASTADO REDONDO", None, 5),
        ("SEM POSTE", "SEM POSTE", None, None),
        ("SEM POSTE - PROJ NO SOLO", "SEM POSTE - PROJ NO SOLO", None, None),
        ("       ", "", None, None),
        (None, "", None, None),
        ("POSTE DE 900 A 1000 M", "POSTE DE 900 A 1000 M", None, None),  # altura implausível
    ],
)
def test_faixa_de_altura_do_poste(poste, tipo, minima, maxima):
    assert importacao.separar_poste(poste) == (tipo, minima, maxima)


def test_grava_o_tipo_e_a_faixa_de_altura(tmp_path):
    importar(planilha(tmp_path, [linha(1, *ALDEOTA, poste="CONCRETO REDONDO DE 11 A 14 M")]))
    ponto = PontoIluminacao.objects.get()
    assert (ponto.poste_tipo, ponto.altura_poste_min_m, ponto.altura_poste_max_m) == (
        "CONCRETO REDONDO",
        11,
        14,
    )


def test_reimportar_e_idempotente_e_substitui_os_pontos(tmp_path):
    caminho = planilha(tmp_path, [linha(1, *ALDEOTA), linha(2, ALDEOTA[0] + 20, ALDEOTA[1])])
    importar(caminho)
    importar(caminho)
    assert PontoIluminacao.objects.count() == 2
    assert LoteIluminacao.objects.count() == 2  # uma execução registrada por importação
    assert {p.lote_id for p in PontoIluminacao.objects.all()} == {LoteIluminacao.objects.first().id}
    # Um ponto que sai da fonte some; o que muda é atualizado.
    novo = planilha(tmp_path, [linha(2, *ALDEOTA, poste="SUPORTE ATÉ 5 M")], nome="novo.xlsx")
    importar(novo)
    (ponto,) = PontoIluminacao.objects.all()
    assert ponto.codigo == "2" and ponto.altura_poste_max_m == 5


def test_falha_na_leitura_nao_altera_o_que_ja_foi_importado(tmp_path):
    importar(planilha(tmp_path, [linha(1, *ALDEOTA)]))
    ruim = tmp_path / "ruim.xlsx"
    ruim.write_bytes(b"isto nao e um xlsx")
    with pytest.raises(CommandError):
        importar(ruim)
    assert PontoIluminacao.objects.count() == 1
    assert LoteIluminacao.objects.count() == 1


def test_planilha_sem_as_colunas_de_coordenada_e_recusada(tmp_path):
    caminho = planilha(tmp_path, [[1, 2]], cabecalho=["CÓDIGO_DE_PONTO_DE_SERVIÇO", "OUTRA"])
    with pytest.raises(CommandError, match="coluna"):
        importar(caminho)


def test_arquivo_inexistente(tmp_path):
    with pytest.raises(CommandError, match="não encontrado"):
        importar(tmp_path / "nao-existe.xlsx")


def test_download_so_de_hosts_permitidos_e_com_limite(monkeypatch, tmp_path):
    with pytest.raises(importacao.ErroPlanilha, match="não permitido"):
        importacao.baixar("https://exemplo.com/x.xlsx", tmp_path / "a.xlsx")
    with pytest.raises(importacao.ErroPlanilha, match="não permitido"):
        importacao.baixar("http://dados.fortaleza.ce.gov.br/x.xlsx", tmp_path / "a.xlsx")

    class Resposta:
        url = importacao.URL_OFICIAL
        headers = {}

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def raise_for_status(self):
            pass

        def iter_content(self, chunk_size):
            while True:
                yield b"x" * chunk_size

    monkeypatch.setattr(importacao.requests, "get", lambda *a, **k: Resposta())
    monkeypatch.setattr(importacao, "LIMITE_DOWNLOAD_BYTES", 1024 * 1024)
    destino = tmp_path / "grande.xlsx"
    with pytest.raises(importacao.ErroPlanilha, match="limite"):
        importacao.baixar(importacao.URL_OFICIAL, destino)
    assert not destino.exists()


def test_a_tarefa_mensal_chama_o_comando(monkeypatch):
    from itree.iluminacao import tasks

    chamadas = []
    monkeypatch.setattr(tasks, "call_command", lambda nome, **kw: chamadas.append(nome))
    tasks.reimportar_iluminacao_publica()
    assert chamadas == ["importar_iluminacao_publica"]


def test_a_tarefa_mensal_esta_no_beat(settings):
    from config.settings import CELERY_BEAT_SCHEDULE

    agenda = CELERY_BEAT_SCHEDULE["reimportar-iluminacao-publica"]
    assert agenda["task"] == "itree.iluminacao.tasks.reimportar_iluminacao_publica"
    assert agenda["schedule"].day_of_month == {3}
