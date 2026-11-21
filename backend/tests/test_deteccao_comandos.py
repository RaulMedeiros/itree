"""Comandos importar_deteccoes e simular_deteccoes."""

import io

import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.core.management.base import CommandError

from itree.deteccao.models import LoteDeteccao, PontoPlantio, SinalRemocao, TokenIntegracao
from itree.evidencias.models import Evidencia
from itree.inventario.models import Arvore

from .conftest import PONTO_A
from .deteccao_util import corpo, det
from .test_deteccao_api import zip_pacote
from .test_galeria_miniaturas import s3 as _armazenamento  # noqa: F401

pytestmark = pytest.mark.django_db


@pytest.fixture
def s3(request):
    return request.getfixturevalue("_armazenamento")


def semear(n=20):
    for i in range(n):
        Arvore.objects.create(
            geom=Point(PONTO_A["longitude"] + i * 0.0002, PONTO_A["latitude"], srid=4326),
            origem_registro="importacao",
            localizacao_origem="importada",
        )


# --- importar_deteccoes ---------------------------------------------------------------------


def test_importar_pacote_pela_linha_de_comando(revisor, tmp_path):
    arquivo = tmp_path / "pacote.zip"
    arquivo.write_bytes(zip_pacote(corpo([det("c1")])))
    saida = io.StringIO()
    call_command("importar_deteccoes", str(arquivo), "--usuario", revisor.email, stdout=saida)
    assert "1 árvore(s) criada(s)" in saida.getvalue()
    lote = LoteDeteccao.objects.get()
    assert (
        lote.canal == "pacote" and lote.enviado_por == revisor and lote.arquivo_nome == "pacote.zip"
    )
    assert Arvore.objects.get().criado_por == revisor


def test_importar_recusa_usuario_sem_permissao_ou_arquivo_ruim(revisor, tmp_path, tecnico_a):
    arquivo = tmp_path / "p.zip"
    arquivo.write_bytes(zip_pacote())
    with pytest.raises(CommandError, match="deteccao.enviar"):
        call_command("importar_deteccoes", str(arquivo), "--usuario", tecnico_a.email)
    with pytest.raises(CommandError, match="não encontrado"):
        call_command("importar_deteccoes", str(arquivo), "--usuario", "ninguem@x.org")
    with pytest.raises(CommandError, match="Arquivo"):
        call_command("importar_deteccoes", str(tmp_path / "nada.zip"), "--usuario", revisor.email)
    ruim = tmp_path / "ruim.zip"
    ruim.write_bytes(b"isto nao e zip")
    with pytest.raises(CommandError):
        call_command("importar_deteccoes", str(ruim), "--usuario", revisor.email)
    assert LoteDeteccao.objects.count() == 0


def test_importar_o_mesmo_pacote_duas_vezes_e_recusado(revisor, tmp_path):
    arquivo = tmp_path / "pacote.zip"
    arquivo.write_bytes(zip_pacote())
    call_command(
        "importar_deteccoes", str(arquivo), "--usuario", revisor.email, stdout=io.StringIO()
    )
    with pytest.raises(CommandError, match="já foi recebido"):
        call_command("importar_deteccoes", str(arquivo), "--usuario", revisor.email)


# --- simular_deteccoes ----------------------------------------------------------------------


def test_simulador_gera_lote_declarado_que_cobre_todos_os_casos(territorios, admin, s3):
    semear(30)
    saida = io.StringIO()
    call_command("simular_deteccoes", stdout=saida)
    video = LoteDeteccao.objects.get(sensor="video_rua")
    satelite = LoteDeteccao.objects.get(sensor="satelite")
    for lote in (video, satelite):
        assert lote.projeto_origem == "simulador-itree" and "sintéticos" in lote.versao_modelo
        assert lote.canal == "api" and lote.integracao is not None
        assert lote.situacao == "concluido" and lote.recusadas == 0, lote.erros
    assert video.arvores_juntadas > 0 and video.arvores_criadas > 0
    assert video.pontos_criados == 3 and video.possiveis_remocoes >= 1
    assert satelite.arvores_criadas > 0
    assert PontoPlantio.objects.filter(tipo="berco_vazio").exists()
    assert PontoPlantio.objects.filter(tipo="toco").exists()
    assert SinalRemocao.objects.filter(lote=video).exists()
    # as fotos são sintéticas e se declaram como tal
    fotos = Evidencia.objects.filter(origem="deteccao")
    assert fotos.exists() and not fotos.filter(ilustrativa=False).exists()
    assert not fotos.filter(anonimizada=False).exists()
    # as três faixas de confiança aparecem nas árvores criadas
    novas = Arvore.objects.filter(confirmada=False)
    assert {a.confianca >= 0.8 for a in novas} == {True, False}


def test_simulador_exige_arvores_semeadas_e_nao_repete_o_lote(territorios, admin, s3):
    with pytest.raises(CommandError, match="semeie"):
        call_command("simular_deteccoes")
    semear(12)
    call_command("simular_deteccoes", stdout=io.StringIO())
    with pytest.raises(CommandError, match="--semente"):
        call_command("simular_deteccoes")
    call_command("simular_deteccoes", "--semente", "2", stdout=io.StringIO())
    assert TokenIntegracao.objects.filter(nome__startswith="Simulador").count() == 1  # reaproveita


def test_simulador_sem_armazenamento_segue_sem_fotos(territorios, admin, settings):
    settings.S3_BUCKET = ""
    semear(12)
    call_command("simular_deteccoes", stdout=io.StringIO(), stderr=io.StringIO())
    assert Evidencia.objects.count() == 0 and Arvore.objects.filter(confirmada=False).exists()
