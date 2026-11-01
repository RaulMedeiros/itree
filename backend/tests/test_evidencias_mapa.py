import boto3
import pytest
from moto import mock_aws

from itree.core import armazenamento
from itree.evidencias.models import Evidencia

from .conftest import PONTO_A, PONTO_B

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


@pytest.fixture
def arvore(cliente, tecnico_a):
    return (
        cliente.como(tecnico_a)
        .post("/api/v1/arvores", {"localizacao": PONTO_A}, format="json")
        .json()
    )


def test_sem_armazenamento_responde_503(cliente, tecnico_a, arvore, settings):
    settings.S3_BUCKET = ""
    r = cliente.como(tecnico_a).post(
        "/api/v1/evidencias",
        {
            "arvore": arvore["id"],
            "nome_original": "f.jpg",
            "tipo_conteudo": "image/jpeg",
            "tamanho": 10,
        },
        format="json",
    )
    assert r.status_code == 503


def test_fluxo_de_envio_direto(cliente, tecnico_a, arvore, s3):
    r = cliente.como(tecnico_a).post(
        "/api/v1/evidencias",
        {
            "arvore": arvore["id"],
            "nome_original": "tronco.jpg",
            "tipo_conteudo": "image/jpeg",
            "tamanho": 5,
            "descricao": "Tronco com ferida",
        },
        format="json",
    )
    assert r.status_code == 201, r.json()
    envio = r.json()
    assert envio["metodo"] == "PUT" and "X-Amz-Signature" in envio["url_envio"]
    evidencia = envio["evidencia"]
    assert evidencia["estado"] == "aguardando_envio"
    url_confirmar = f"/api/v1/evidencias/{evidencia['id']}/confirmar"

    # Ainda não enviado.
    assert cliente.post(url_confirmar).status_code == 400
    chave = Evidencia.objects.get(pk=evidencia["id"]).chave
    s3.put_object(Bucket="itree-teste", Key=chave, Body=b"12345", ContentType="image/jpeg")
    r = cliente.post(url_confirmar)
    assert r.status_code == 200, r.json()
    assert r.json()["estado"] == "disponivel"

    lista = cliente.get("/api/v1/evidencias", {"arvore": arvore["id"]}).json()
    assert len(lista) == 1 and lista[0]["url"].startswith("https://")

    r = cliente.post(
        f"/api/v1/evidencias/{evidencia['id']}/remover", {"motivo": "Foto errada"}, format="json"
    )
    assert r.json()["estado"] == "removida"
    assert cliente.get("/api/v1/evidencias", {"arvore": arvore["id"]}).json() == []


def test_tamanho_divergente_e_tipo_proibido(cliente, tecnico_a, arvore, s3):
    cliente.como(tecnico_a)
    r = cliente.post(
        "/api/v1/evidencias",
        {
            "arvore": arvore["id"],
            "nome_original": "a.exe",
            "tipo_conteudo": "application/x-msdownload",
            "tamanho": 5,
        },
        format="json",
    )
    assert r.status_code == 400
    envio = cliente.post(
        "/api/v1/evidencias",
        {
            "arvore": arvore["id"],
            "nome_original": "a.png",
            "tipo_conteudo": "image/png",
            "tamanho": 99,
        },
        format="json",
    ).json()
    ev = envio["evidencia"]
    chave = Evidencia.objects.get(pk=ev["id"]).chave
    s3.put_object(Bucket="itree-teste", Key=chave, Body=b"123")
    assert cliente.post(f"/api/v1/evidencias/{ev['id']}/confirmar").status_code == 400


def test_evidencia_fora_do_escopo(cliente, tecnico_a, revisor, s3):
    outra = (
        cliente.como(revisor)
        .post("/api/v1/arvores", {"localizacao": PONTO_B}, format="json")
        .json()
    )
    r = cliente.como(tecnico_a).post(
        "/api/v1/evidencias",
        {
            "arvore": outra["id"],
            "nome_original": "f.jpg",
            "tipo_conteudo": "image/jpeg",
            "tamanho": 1,
        },
        format="json",
    )
    assert r.status_code == 400


# --- Mapa -------------------------------------------------------------------


def _tile(lon, lat, z):
    import math

    n = 2**z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def test_vector_tiles_respeitam_escopo(cliente, tecnico_a, revisor):
    cliente.como(revisor).post("/api/v1/arvores", {"localizacao": PONTO_B}, format="json")
    for z in (17, 11):  # individual e agrupado
        x, y = _tile(PONTO_B["longitude"], PONTO_B["latitude"], z)
        r = cliente.como(revisor).get(f"/api/v1/mapa/tiles/arvores/{z}/{x}/{y}")
        assert r.status_code == 200
        assert r["Content-Type"] == "application/vnd.mapbox-vector-tile"
        assert len(r.content) > 0, z
        assert (
            len(cliente.como(tecnico_a).get(f"/api/v1/mapa/tiles/arvores/{z}/{x}/{y}").content) == 0
        )


def test_tile_invalido_e_camada_desconhecida(cliente, revisor):
    assert cliente.como(revisor).get("/api/v1/mapa/tiles/arvores/2/9/9").status_code == 404
    assert cliente.get("/api/v1/mapa/tiles/sensores/1/0/0").status_code == 404


def test_busca_global(cliente, revisor):
    arvore = (
        cliente.como(revisor)
        .post(
            "/api/v1/arvores",
            {"localizacao": PONTO_A, "endereco": "Av. Beira Mar, 100"},
            format="json",
        )
        .json()
    )
    tipos = lambda q: [
        (r["tipo"], r["rotulo"]) for r in cliente.get("/api/v1/mapa/busca", {"q": q}).json()
    ]  # noqa: E731
    assert ("arvore", arvore["codigo"]) in tipos(arvore["codigo"])
    assert ("arvore", arvore["codigo"]) in tipos("beira mar")
    assert ("territorio", "Bairro A") in tipos("bairro a")
    assert tipos("-3.755, -38.555")[0] == ("coordenada", "-3.755000, -38.555000")


def test_camadas_informam_fonte(cliente, revisor):
    corpo = cliente.como(revisor).get("/api/v1/mapa/camadas").json()
    bairros = next(t for t in corpo["territorios"] if t["tipo"] == "bairro")
    assert bairros["fontes"] == ["Teste"] and bairros["quantidade"] == 2
    assert corpo["arvores"]["total"] == 0
    assert len(corpo["limites_escopo"]) == 4
