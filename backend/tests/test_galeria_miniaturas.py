"""Galeria de fotos, linha do tempo e miniaturas da ficha da árvore."""

import io
from datetime import timedelta

import boto3
import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone
from moto import mock_aws
from PIL import Image

from itree.core import armazenamento
from itree.evidencias.miniaturas import LADO_MAXIMO, gerar_miniatura, reduzir
from itree.evidencias.models import Evidencia
from itree.inspecoes.models import Inspecao
from itree.inventario.models import Arvore, Medida
from itree.ocorrencias.models import Ocorrencia
from itree.tarefas.models import Tarefa

from .conftest import PONTO_A, PONTO_B, com_escopo, criar_usuario

pytestmark = pytest.mark.django_db


@pytest.fixture
def s3(settings):
    settings.S3_BUCKET = "itree-teste"
    settings.S3_ENDPOINT_URL = None
    settings.S3_ENDPOINT_URL_PUBLICO = None
    settings.S3_ACCESS_KEY_ID = "teste"
    settings.S3_SECRET_ACCESS_KEY = "teste"
    settings.S3_REGION = "us-east-1"
    armazenamento.cliente_interno.cache_clear()
    armazenamento.cliente_publico.cache_clear()
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="itree-teste")
        yield boto3.client("s3", region_name="us-east-1")
    armazenamento.cliente_interno.cache_clear()
    armazenamento.cliente_publico.cache_clear()


def png(largura=1200, altura=800, modo="RGB") -> bytes:
    saida = io.BytesIO()
    Image.new(modo, (largura, altura), "green").save(saida, "PNG")
    return saida.getvalue()


def ponto(p) -> Point:
    return Point(p["longitude"], p["latitude"], srid=4326)


@pytest.fixture
def arvore(db):
    return Arvore.objects.create(geom=ponto(PONTO_A), origem_registro="web")


def foto(autor, s3, *, quando, descricao="", conteudo=None, **vinculo) -> Evidencia:
    """Evidência disponível, com o arquivo já no armazenamento."""
    ident = len(Evidencia.objects.all())
    chave = f"evidencias/2026/11/teste-{ident}-{quando:%H%M%S}.png"
    corpo = conteudo or png()
    s3.put_object(Bucket="itree-teste", Key=chave, Body=corpo, ContentType="image/png")
    return Evidencia.objects.create(
        chave=chave,
        nome_original="f.png",
        tipo_conteudo="image/png",
        tamanho=len(corpo),
        descricao=descricao,
        capturada_em=quando,
        estado="disponivel",
        enviada_por=autor,
        **vinculo,
    )


# --- miniaturas --------------------------------------------------------------


def test_reduzir_limita_o_maior_lado_e_gera_jpeg():
    saida = Image.open(io.BytesIO(reduzir(png(2000, 1000))))
    assert saida.format == "JPEG"
    assert max(saida.size) == LADO_MAXIMO


def test_reduzir_aceita_png_com_transparencia():
    saida = Image.open(io.BytesIO(reduzir(png(100, 100, "RGBA"))))
    assert saida.mode == "RGB"


def test_confirmar_envio_gera_a_miniatura(cliente, tecnico_a, arvore, s3):
    c = cliente.como(tecnico_a)
    corpo = png()
    envio = c.post(
        "/api/v1/evidencias",
        {
            "arvore": str(arvore.pk),
            "nome_original": "t.png",
            "tipo_conteudo": "image/png",
            "tamanho": len(corpo),
        },
        format="json",
    ).json()
    evidencia = Evidencia.objects.get(pk=envio["evidencia"]["id"])
    s3.put_object(Bucket="itree-teste", Key=evidencia.chave, Body=corpo, ContentType="image/png")
    r = c.post(f"/api/v1/evidencias/{evidencia.pk}/confirmar")
    assert r.status_code == 200, r.json()
    assert r.json()["url_miniatura"]
    evidencia.refresh_from_db()
    assert evidencia.chave_miniatura.startswith("evidencias/miniaturas/")
    objeto = s3.get_object(Bucket="itree-teste", Key=evidencia.chave_miniatura)
    assert Image.open(io.BytesIO(objeto["Body"].read())).format == "JPEG"


def test_imagem_corrompida_confirma_sem_miniatura(cliente, tecnico_a, arvore, s3):
    c = cliente.como(tecnico_a)
    envio = c.post(
        "/api/v1/evidencias",
        {
            "arvore": str(arvore.pk),
            "nome_original": "t.png",
            "tipo_conteudo": "image/png",
            "tamanho": 5,
        },
        format="json",
    ).json()
    evidencia = Evidencia.objects.get(pk=envio["evidencia"]["id"])
    s3.put_object(Bucket="itree-teste", Key=evidencia.chave, Body=b"12345")
    r = c.post(f"/api/v1/evidencias/{evidencia.pk}/confirmar")
    assert r.status_code == 200
    assert r.json()["estado"] == "disponivel" and r.json()["url_miniatura"] is None


def test_pdf_nao_tem_miniatura(tecnico_a, arvore, s3):
    ev = foto(tecnico_a, s3, quando=timezone.now(), arvore=arvore)
    ev.tipo_conteudo = "application/pdf"
    assert gerar_miniatura(ev) is False


def test_comando_gera_so_as_que_faltam(tecnico_a, arvore, s3, capsys):
    agora = timezone.now()
    sem = foto(tecnico_a, s3, quando=agora, arvore=arvore)
    com = foto(tecnico_a, s3, quando=agora + timedelta(seconds=1), arvore=arvore)
    gerar_miniatura(com)
    com.refresh_from_db()
    chave_antiga = com.chave_miniatura
    call_command("gerar_miniaturas")
    sem.refresh_from_db()
    com.refresh_from_db()
    assert sem.chave_miniatura
    assert com.chave_miniatura == chave_antiga
    assert "Miniaturas geradas: 1" in capsys.readouterr().out


def test_comando_sem_armazenamento_avisa(settings):
    settings.S3_BUCKET = ""
    with pytest.raises(CommandError):
        call_command("gerar_miniaturas")


# --- fotos da árvore -----------------------------------------------------------


def _inspecao(arvore, tecnico, quando, condicao="regular", estado="validada"):
    return Inspecao.objects.create(
        arvore=arvore,
        tecnico=tecnico,
        realizada_em=quando,
        condicao_aparente=condicao,
        estado=estado,
        validada_em=quando if estado == "validada" else None,
    )


def _ocorrencia(arvore, tipo, autor, **extras):
    return Ocorrencia.objects.create(
        tipo=tipo,
        arvore=arvore,
        geom=arvore.geom,
        descricao="Galho",
        origem="web",
        registrada_por=autor,
        **extras,
    )


def test_fotos_juntam_as_origens_em_ordem_cronologica(cliente, tecnico_a, arvore, tipo_queda, s3):
    t0 = timezone.now() - timedelta(days=30)
    insp = _inspecao(arvore, tecnico_a, t0)
    oco = _ocorrencia(arvore, tipo_queda, tecnico_a)
    foto(tecnico_a, s3, quando=t0 + timedelta(days=20), arvore=arvore, descricao="própria")
    foto(tecnico_a, s3, quando=t0 + timedelta(days=1), inspecao=insp, descricao="da inspeção")
    foto(tecnico_a, s3, quando=t0 + timedelta(days=10), ocorrencia=oco, descricao="da ocorrência")
    r = cliente.como(tecnico_a).get(f"/api/v1/arvores/{arvore.pk}/fotos")
    assert r.status_code == 200, r.json()
    fotos = r.json()
    assert [f["descricao"] for f in fotos] == ["da inspeção", "da ocorrência", "própria"]
    assert [f["origem"] for f in fotos] == ["inspecao", "ocorrencia", "evidencia"]
    assert fotos[0]["origem_codigo"] == insp.codigo and fotos[0]["origem_id"] == str(insp.pk)
    assert fotos[1]["origem_codigo"] == oco.codigo
    assert fotos[2]["origem_codigo"] == arvore.codigo
    assert fotos[0]["autor"] and "X-Amz-Signature" in fotos[0]["url"]


def test_fotos_ignoram_documentos_removidas_e_pendentes(cliente, tecnico_a, arvore, s3):
    agora = timezone.now()
    foto(tecnico_a, s3, quando=agora, arvore=arvore, descricao="boa")
    pdf = foto(tecnico_a, s3, quando=agora, arvore=arvore, descricao="pdf")
    pdf.tipo_conteudo = "application/pdf"
    pdf.save()
    foto(tecnico_a, s3, quando=agora, arvore=arvore, descricao="removida")
    Evidencia.objects.filter(descricao="removida").update(estado="removida")
    foto(tecnico_a, s3, quando=agora, arvore=arvore, descricao="pendente")
    Evidencia.objects.filter(descricao="pendente").update(estado="aguardando_envio")
    fotos = cliente.como(tecnico_a).get(f"/api/v1/arvores/{arvore.pk}/fotos").json()
    assert [f["descricao"] for f in fotos] == ["boa"]


def test_miniatura_vem_na_foto_quando_existe(cliente, tecnico_a, arvore, s3):
    ev = foto(tecnico_a, s3, quando=timezone.now(), arvore=arvore)
    assert (
        cliente.como(tecnico_a).get(f"/api/v1/arvores/{arvore.pk}/fotos").json()[0]["url_miniatura"]
        is None
    )
    gerar_miniatura(ev)
    f = cliente.get(f"/api/v1/arvores/{arvore.pk}/fotos").json()[0]
    assert "evidencias/miniaturas/" in f["url_miniatura"]
    assert f["url"] != f["url_miniatura"]


def test_fotos_fora_do_escopo_dao_404(cliente, territorios, arvore, s3):
    de_b = com_escopo(criar_usuario("b@itree.teste", ["tecnico"]), territorios["b"])
    assert cliente.como(de_b).get(f"/api/v1/arvores/{arvore.pk}/fotos").status_code == 404


def test_fotos_exigem_leitura_do_inventario(cliente, arvore):
    r = cliente.get(f"/api/v1/arvores/{arvore.pk}/fotos")
    assert r.status_code in (401, 403)


def test_quem_nao_le_inspecoes_nao_ve_as_fotos_delas(
    cliente, tecnico_a, territorios, arvore, tipo_queda, s3
):
    insp = _inspecao(arvore, tecnico_a, timezone.now())
    oco = _ocorrencia(arvore, tipo_queda, tecnico_a)
    foto(tecnico_a, s3, quando=timezone.now(), inspecao=insp, descricao="da inspeção")
    foto(tecnico_a, s3, quando=timezone.now(), ocorrencia=oco, descricao="da ocorrência")
    consulta = com_escopo(criar_usuario("c@itree.teste", ["consulta"]), territorios["a"])
    fotos = cliente.como(consulta).get(f"/api/v1/arvores/{arvore.pk}/fotos").json()
    assert [f["descricao"] for f in fotos] == ["da ocorrência"]


def test_foto_de_ocorrencia_de_outra_arvore_nao_entra(cliente, tecnico_a, arvore, tipo_queda, s3):
    outra = Arvore.objects.create(geom=ponto(PONTO_A), origem_registro="web")
    oco = _ocorrencia(outra, tipo_queda, tecnico_a)
    foto(tecnico_a, s3, quando=timezone.now(), ocorrencia=oco)
    assert cliente.como(tecnico_a).get(f"/api/v1/arvores/{arvore.pk}/fotos").json() == []


def test_ocorrencia_fora_do_escopo_nao_entra(cliente, territorios, tipo_queda, s3):
    # Árvore sem localização, visível ao município; ocorrência no bairro B.
    gm = com_escopo(criar_usuario("g@itree.teste", ["gestor"]), territorios["a"])
    arvore = Arvore.objects.create(geom=ponto(PONTO_A), origem_registro="web")
    oco = Ocorrencia.objects.create(
        tipo=tipo_queda,
        arvore=arvore,
        geom=ponto(PONTO_B),
        descricao="x",
        origem="web",
        registrada_por=gm,
    )
    foto(gm, s3, quando=timezone.now(), ocorrencia=oco)
    assert cliente.como(gm).get(f"/api/v1/arvores/{arvore.pk}/fotos").json() == []


# --- linha do tempo ------------------------------------------------------------


def test_linha_do_tempo_traz_eventos_condicao_e_medidas(cliente, tecnico_a, arvore, tipo_queda):
    t0 = timezone.now() - timedelta(days=100)
    _inspecao(arvore, tecnico_a, t0, "boa")
    _inspecao(arvore, tecnico_a, t0 + timedelta(days=50), "ruim")
    _inspecao(arvore, tecnico_a, t0 + timedelta(days=60), "boa", estado="em_revisao")
    _ocorrencia(arvore, tipo_queda, tecnico_a)
    poda = tipo_queda.__class__.objects.create(nome="Poda de galho")
    oco_poda = _ocorrencia(arvore, poda, tecnico_a)
    Tarefa.objects.create(
        tipo="atendimento_ocorrencia",
        arvore=arvore,
        ocorrencia=oco_poda,
        geom=arvore.geom,
        criada_por=tecnico_a,
        estado="concluida",
        concluida_em=t0 + timedelta(days=70),
        resultado="Poda feita",
    )
    Medida.objects.create(
        arvore=arvore,
        tipo="altura",
        valor=8,
        unidade="m",
        metodo="trena",
        origem="medido",
        data_medicao=(t0 - timedelta(days=200)).date(),
    )
    Medida.objects.create(
        arvore=arvore,
        tipo="altura",
        valor=9.5,
        unidade="m",
        metodo="trena",
        origem="medido",
        data_medicao=t0.date(),
    )
    Medida.objects.create(
        arvore=arvore,
        tipo="dap",
        valor=30,
        unidade="cm",
        metodo="fita",
        origem="medido",
        data_medicao=t0.date(),
    )
    Medida.objects.create(
        arvore=arvore,
        tipo="dap",
        valor=99,
        unidade="cm",
        metodo="fita",
        origem="medido",
        data_medicao=t0.date(),
        aplicada=False,
    )
    r = cliente.como(tecnico_a).get(f"/api/v1/arvores/{arvore.pk}/linha-do-tempo")
    assert r.status_code == 200, r.json()
    d = r.json()
    tipos = [e["tipo"] for e in d["eventos"]]
    assert tipos[0] == "medicao"  # a medição de 300 dias atrás antecede o cadastro de hoje
    assert {"cadastro", "medicao", "inspecao", "ocorrencia", "poda"} <= set(tipos)
    datas = [e["data"] for e in d["eventos"]]
    assert datas == sorted(datas)
    # Só a condição das inspeções validadas, em degraus.
    assert [c["condicao"] for c in d["condicao"]] == ["boa", "ruim"]
    # Inspeção em revisão aparece sem condição.
    em_revisao = [e for e in d["eventos"] if e["tipo"] == "inspecao" and not e["condicao"]]
    assert len(em_revisao) == 1
    series = {s["tipo"]: s for s in d["medidas"]}
    assert [p["valor"] for p in series["altura"]["pontos"]] == [8.0, 9.5]
    assert series["altura"]["unidade"] == "m"
    assert [p["valor"] for p in series["dap"]["pontos"]] == [30.0]  # a não aplicada fica fora


def test_linha_do_tempo_respeita_permissoes_e_escopo(
    cliente, tecnico_a, territorios, arvore, tipo_queda
):
    _inspecao(arvore, tecnico_a, timezone.now())
    _ocorrencia(arvore, tipo_queda, tecnico_a)
    consulta = com_escopo(criar_usuario("c@itree.teste", ["consulta"]), territorios["a"])
    tipos = [
        e["tipo"]
        for e in cliente.como(consulta)
        .get(f"/api/v1/arvores/{arvore.pk}/linha-do-tempo")
        .json()["eventos"]
    ]
    assert "inspecao" not in tipos and "ocorrencia" in tipos
    de_b = com_escopo(criar_usuario("b@itree.teste", ["tecnico"]), territorios["b"])
    assert cliente.como(de_b).get(f"/api/v1/arvores/{arvore.pk}/linha-do-tempo").status_code == 404
