"""Selos de origem e confiança, estado "detectada" e confirmação da árvore."""

from datetime import timedelta

import pytest
from django.contrib.gis.geos import Point
from django.utils import timezone

from itree.deteccao import servico
from itree.deteccao.confianca import faixa_de_confianca
from itree.inspecoes.models import CondicaoAparente, Inspecao
from itree.inventario.models import Arvore

from .conftest import PONTO_A, criar_usuario
from .deteccao_util import corpo, deslocar, det
from .mvt_util import decodificar
from .test_evidencias_mapa import _tile

pytestmark = pytest.mark.django_db


@pytest.fixture
def envio(territorios, admin):
    token, _ = servico.criar_token("Projeto", [territorios["municipio"]], admin)
    return servico.Envio(canal="api", usuario=token.usuario, integracao=token)


def detectar(envio, confianca=0.9, sensor="video_rua", local=None, **extra):
    lote = servico.enviar(
        corpo(sensor=sensor, id=f"l-{timezone.now().timestamp()}")["lote"],
        [det(local=local, confianca=confianca, **extra)],
        envio,
    )
    return Arvore.objects.get(observacoes_deteccao__lote=lote)


# --- Faixas de confiança --------------------------------------------------------------------


@pytest.mark.parametrize(
    "valor,faixa",
    [
        (0.0, "baixa"),
        (0.49, "baixa"),
        (0.5, "media"),
        (0.79, "media"),
        (0.8, "alta"),
        (1.0, "alta"),
        (None, ""),
    ],
)
def test_tres_faixas_de_confianca(valor, faixa):
    assert faixa_de_confianca(valor) == faixa


def test_limiares_vem_das_configuracoes(settings):
    settings.DETECCAO_CONFIANCA_MEDIA, settings.DETECCAO_CONFIANCA_ALTA = 0.3, 0.6
    assert [faixa_de_confianca(v) for v in (0.2, 0.3, 0.59, 0.6)] == [
        "baixa",
        "media",
        "media",
        "alta",
    ]


# --- Selos na API ---------------------------------------------------------------------------


def test_ficha_e_lista_trazem_selo_de_origem_e_de_confianca(cliente, revisor, envio):
    sat = detectar(envio, 0.3, "satelite")
    video = detectar(envio, 0.85, "video_rua", local=deslocar(PONTO_A, 50))
    manual = Arvore.objects.create(
        geom=Point(PONTO_A["longitude"] - 0.001, PONTO_A["latitude"], srid=4326),
        origem_registro="web",
        localizacao_origem="estimada_web",
    )
    cliente.como(revisor)
    ficha = cliente.get(f"/api/v1/arvores/{sat.id}").json()
    assert (ficha["deteccao"], ficha["faixa_confianca"], ficha["confirmada"]) == (
        "satelite",
        "baixa",
        False,
    )
    assert ficha["origem_registro"] == "deteccao_satelite" and ficha["confianca"] == 0.3
    assert cliente.get(f"/api/v1/arvores/{video.id}").json()["faixa_confianca"] == "alta"
    lista = {a["id"]: a for a in cliente.get("/api/v1/arvores").json()["results"]}
    assert lista[str(video.id)]["deteccao"] == "video_rua"
    assert lista[str(manual.id)]["deteccao"] == "" and lista[str(manual.id)]["confirmada"] is True
    assert lista[str(manual.id)]["faixa_confianca"] == ""


def test_filtros_da_lista_por_confirmada_e_por_origem(cliente, revisor, envio):
    sat = detectar(envio, 0.9, "satelite")
    video = detectar(envio, 0.9, "video_rua", local=deslocar(PONTO_A, 50))
    manual = Arvore.objects.create(
        geom=Point(PONTO_A["longitude"] - 0.001, PONTO_A["latitude"], srid=4326),
        origem_registro="web",
    )
    cliente.como(revisor)

    def ids(**params):
        r = cliente.get("/api/v1/arvores", params)
        assert r.status_code == 200, r.json()
        return {a["id"] for a in r.json()["results"]}

    assert ids(confirmada="false") == {str(sat.id), str(video.id)}
    assert ids(confirmada="true") == {str(manual.id)}
    assert ids(deteccao="satelite") == {str(sat.id)}
    assert ids(deteccao="video_rua") == {str(video.id)}
    assert ids(deteccao="qualquer") == {str(sat.id), str(video.id)}
    assert cliente.get("/api/v1/arvores", {"deteccao": "drone"}).status_code == 400


def test_busca_global_traz_o_selo(cliente, revisor, envio):
    arvore = detectar(envio, 0.9, "satelite")
    r = cliente.como(revisor).get("/api/v1/mapa/busca", {"q": arvore.codigo})
    item = next(i for i in r.json() if i["tipo"] == "arvore")
    assert (item["deteccao"], item["confirmada"]) == ("satelite", False)


def test_observacoes_da_arvore_na_ficha(cliente, revisor, envio):
    arvore = detectar(envio, 0.62, "video_rua", medidas={"altura": {"valor": 7, "unidade": "m"}})
    r = cliente.como(revisor).get(f"/api/v1/arvores/{arvore.id}/observacoes")
    assert r.status_code == 200
    obs = r.json()[0]
    assert (obs["sensor"], obs["resultado"], obs["faixa_confianca"]) == (
        "video_rua",
        "criou",
        "media",
    )
    assert (
        obs["valores"]["medidas"]["altura"]["valor"] == 7
        and obs["lote_projeto"] == "deteccao-arvores"
    )


# --- Mapa: propriedade do tile --------------------------------------------------------------


def test_tile_do_mapa_distingue_a_arvore_nao_confirmada(cliente, revisor, envio, territorios):
    detectada = detectar(envio)
    confirmada = Arvore.objects.create(
        geom=Point(PONTO_A["longitude"] - 0.0003, PONTO_A["latitude"], srid=4326),
        origem_registro="web",
    )
    x, y = _tile(PONTO_A["longitude"], PONTO_A["latitude"], 17)
    tile = cliente.como(revisor).get(f"/api/v1/mapa/tiles/arvores/17/{x}/{y}").content
    props = {f["props"]["id"]: f["props"] for f in decodificar(tile, 17, x, y)["arvores"]}
    assert props[str(detectada.id)]["confirmada"] is False
    assert props[str(confirmada.id)]["confirmada"] is True


# --- Confirmar árvore -----------------------------------------------------------------------


def test_confirmar_arvore_exige_permissao_de_revisao(
    cliente, envio, gestor_municipal, tecnico_a, revisor
):
    arvore = detectar(envio)
    url = f"/api/v1/arvores/{arvore.id}/confirmar"
    assert cliente.como(gestor_municipal).post(url).status_code == 403
    assert cliente.como(tecnico_a).post(url).status_code == 403
    r = cliente.como(revisor).post(url, {"motivo": "Conferi a foto."}, format="json")
    assert r.status_code == 200, r.json()
    assert r.json()["confirmada"] is True
    arvore.refresh_from_db()
    assert arvore.confirmada and arvore.confirmada_por == revisor and arvore.confirmada_em
    assert arvore.origem_registro == "deteccao_video"  # a origem continua visível
    assert cliente.post(url).status_code == 400  # já confirmada


def test_confirmar_respeita_o_escopo_territorial(cliente, envio, territorios):
    from .conftest import com_escopo

    arvore = detectar(envio)
    revisor_b = com_escopo(criar_usuario("rb@itree.teste", ["revisor"]), territorios["b"])
    assert cliente.como(revisor_b).post(f"/api/v1/arvores/{arvore.id}/confirmar").status_code == 404


def test_inspecao_validada_confirma_a_arvore(cliente, envio, revisor, territorios):
    from .conftest import com_escopo

    arvore = detectar(envio)
    tecnico = com_escopo(criar_usuario("tec@itree.teste", ["tecnico"]), territorios["municipio"])
    agora = timezone.now()
    inspecao = Inspecao.objects.create(
        arvore=arvore,
        tecnico=tecnico,
        realizada_em=agora - timedelta(hours=1),
        condicao_aparente=CondicaoAparente.BOA,
        estado="em_revisao",
    )
    from itree.inspecoes import servicos

    servicos.validar(inspecao, revisor, ["condicao_aparente"])
    arvore.refresh_from_db()
    assert arvore.confirmada is True and arvore.confirmada_por == revisor


def test_inspecao_so_rascunho_nao_confirma(envio):
    arvore = detectar(envio)
    arvore.refresh_from_db()
    assert arvore.confirmada is False


def test_arvores_comuns_nascem_confirmadas(cliente, revisor):
    r = cliente.como(revisor).post("/api/v1/arvores", {"localizacao": PONTO_A}, format="json")
    assert r.status_code == 201, r.json()
    assert r.json()["confirmada"] is True and r.json()["deteccao"] == ""
