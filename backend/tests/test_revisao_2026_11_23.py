"""Regressões dos achados da revisão de código de 23/11/2026 (PRs #94 a #124)."""

import json

import pytest
import responses
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from itree.conectores import servico as servico_conectores
from itree.deteccao import servico
from itree.deteccao.models import LoteDeteccao, SinalRemocao

from .conftest import PONTO_A, criar_usuario
from .deteccao_util import LOTE_URL, com_token, corpo, deslocar, det, foto, imagem
from .test_conectores import _rede_controlada, colecao, criar_conector, ponto, servir  # noqa: F401
from .test_deteccao_juncao import POLIGONO_A, arvore_em

pytestmark = pytest.mark.django_db


def test_coordenada_nan_recusa_a_deteccao_sem_derrubar_o_lote(cliente, territorios, admin):
    """M1: NaN não cabe em JSON; antes, a recusa gravava NaN e o lote inteiro dava 500."""
    com_token(cliente, [territorios["municipio"]], admin)
    ruim = det("ruim", local={"longitude": "nan", "latitude": 0})
    r = cliente.post(LOTE_URL, corpo([det("ok"), ruim]), format="json")
    assert r.status_code in (201, 202), r.content
    lote = LoteDeteccao.objects.get()
    assert lote.recusadas == 1 and "longitude" not in lote.erros[0]


def test_envio_sem_escopo_nao_abre_possivel_remocao(territorios):
    """M2: sem escopo o envio não vale em lugar nenhum, nem para sinalizar remoções."""
    sem_escopo = criar_usuario("sem-escopo@itree.teste", ["revisor"])
    arvore_em(deslocar(PONTO_A, 40))
    envio = servico.Envio(canal="api", usuario=sem_escopo)
    c = corpo([det()], area_coberta=POLIGONO_A, capturado_em=timezone.localdate().isoformat())
    lote = servico.enviar(c["lote"], c["deteccoes"], envio)
    servico.processar(lote.pk)
    assert SinalRemocao.objects.count() == 0


def test_multipart_grande_demais_responde_413_em_json(cliente, territorios, admin, settings):
    """M3: o limite de arquivos do Django virava um 400 em HTML, sem motivo."""
    settings.DATA_UPLOAD_MAX_NUMBER_FILES = 3
    com_token(cliente, [territorios["municipio"]], admin)
    dets = [det(f"d{i}", fotos=[foto(f"f{i}.png")]) for i in range(4)]
    partes = {"dados": SimpleUploadedFile("dados.json", json.dumps(corpo(dets)).encode())}
    for i in range(4):
        partes[f"f{i}"] = SimpleUploadedFile(f"f{i}.png", imagem(), content_type="image/png")
    r = cliente.post(LOTE_URL, partes, format="multipart")
    assert r.status_code == 413
    assert "pacote" in r.json()["detail"]


@responses.activate
def test_total_da_camada_de_referencia_nao_cresce_com_as_sincronizacoes(cliente, tecnico_a):
    """M4: dois Count sobre junções se multiplicavam (2 feições × 2 execuções = 4)."""
    conector = criar_conector(nome="Ativo")
    for _ in range(2):
        servir(corpo=colecao(ponto(-38.5, -3.8, id=1), ponto(-38.51, -3.81, id=2)))
        servico_conectores.sincronizar(conector)
    camada = cliente.como(tecnico_a).get("/api/v1/mapa/camadas-referencia").json()[0]
    assert camada["total"] == 2


def test_lote_invalido_na_lista_de_remocoes_responde_400(cliente, revisor):
    """B1: ?lote=abc virava 500."""
    r = cliente.como(revisor).get("/api/v1/deteccoes/remocoes", {"lote": "abc"})
    assert r.status_code == 400
