"""Regra 3-30-300 por bairro: cada parte com geometrias sintéticas (bordas incluídas), NDVI com
raster sintético, leitura, selos, escopo, permissões e número de consultas. Sem rede."""

import io
from datetime import date

import pytest
from django.contrib.gis.gdal import GDALRaster
from django.contrib.gis.geos import MultiPolygon, Point, Polygon
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from itree.areas_verdes.models import AreaVerde
from itree.imoveis.models import Edificacao, LoteEdificacoes
from itree.indicadores import regra_3_30_300 as regra
from itree.indicadores import vegetacao
from itree.indicadores.models import IndicadorTerritorialExterno, ResultadoRegra330300
from itree.indicadores.tasks import calcular_3_30_300
from itree.inventario.models import Arvore

from .conftest import PONTO_A, criar_territorio, criar_usuario, quadrado

pytestmark = pytest.mark.django_db

# Origem métrica (SIRGAS 2000 / UTM 24S) dentro do Bairro A.
ORIGEM = Point(PONTO_A["longitude"], PONTO_A["latitude"], srid=4326).transform(31984, clone=True)
E0, N0 = ORIGEM.x, ORIGEM.y


def geo(dx, dy, base=(E0, N0)) -> Point:
    """Ponto a (dx, dy) metros da base, em WGS 84."""
    return Point(base[0] + dx, base[1] + dy, srid=31984).transform(4326, clone=True)


def poligono_m(x0, y0, largura, altura) -> MultiPolygon:
    """Retângulo em metros a partir de (E0 + x0, N0 + y0), em WGS 84."""
    p = Polygon.from_bbox((E0 + x0, N0 + y0, E0 + x0 + largura, N0 + y0 + altura))
    p.srid = 31984
    p.transform(4326)
    return MultiPolygon(p, srid=4326)


@pytest.fixture
def lote(db):
    return LoteEdificacoes.objects.create(
        fonte="open_buildings", fonte_texto="t", ingerido_em=timezone.now()
    )


def edificacao(lote, bairro, dx=0.0, dy=0.0, uso="residencial"):
    c = geo(dx, dy)
    return Edificacao.objects.create(
        lote=lote,
        fonte="open_buildings",
        geom=Polygon.from_bbox((c.x - 1e-5, c.y - 1e-5, c.x + 1e-5, c.y + 1e-5)),
        centro=c,
        area_m2=60,
        bairro=bairro,
        uso=uso,
    )


def arvore(dx, dy=0.0, confirmada=True, **extras):
    return Arvore.objects.create(
        origem_registro="importacao",
        localizacao_origem="importada",
        geom=geo(dx, dy),
        especie_estado="confirmada" if confirmada else "sugerida_ia",
        # "Confirmada" é a da detecção automática (helper indicadores.contagem).
        confirmada=confirmada,
        **extras,
    )


def area_verde(poligono, subtipo="", tipo="praca", nome="Verde"):
    return AreaVerde.objects.create(
        tipo=tipo,
        subtipo=subtipo,
        nome=nome,
        geom=poligono,
        fonte="Teste",
        ingerido_em=timezone.now(),
    )


def resultado(bairro, contagem="todas") -> ResultadoRegra330300:
    return ResultadoRegra330300.objects.get(bairro=bairro, contagem=contagem)


# --- "3": árvores a até 30 m ---------------------------------------------------------------


def test_parte_3_exige_tres_arvores_e_o_limite_de_30_m_conta(territorios, lote):
    a = territorios["a"]
    edificacao(lote, a)
    for dx in (10, 20, 29.99):
        arvore(dx)
    arvore(30.01)  # logo depois do limite: não conta
    regra.calcular()
    r = resultado(a)
    assert (r.edificacoes, r.com_3_arvores) == (1, 1)  # três árvores dentro de 30 m
    arvore(0, 30.5)  # uma quarta, mas fora
    # Tirando uma das de dentro, restam duas dentro e duas fora: não atende.
    Arvore.objects.filter(geom=geo(10, 0)).delete()
    regra.calcular()
    assert resultado(a).com_3_arvores == 0


def test_parte_3_exatamente_a_30_m_conta_e_duas_arvores_nao_bastam(territorios, lote):
    a = territorios["a"]
    edificacao(lote, a)
    arvore(5)
    arvore(15)
    regra.calcular()
    assert resultado(a).com_3_arvores == 0  # só duas
    arvore(29.9999)  # praticamente a 30 m: dentro (a distância é "até 30 m")
    regra.calcular()
    assert resultado(a).com_3_arvores == 1


def test_parte_3_contagem_confirmadas_ignora_as_nao_confirmadas(territorios, lote):
    a = territorios["a"]
    edificacao(lote, a)
    arvore(5)
    arvore(10)
    arvore(15, confirmada=False)
    regra.calcular()
    assert resultado(a, "todas").com_3_arvores == 1
    assert resultado(a, "confirmadas").com_3_arvores == 0


def test_parte_3_so_conta_arvores_validas(territorios, lote):
    a = territorios["a"]
    edificacao(lote, a)
    arvore(5)
    arvore(10)
    arvore(12, situacao="removida")  # inativa: não conta
    regra.calcular()
    assert resultado(a).com_3_arvores == 0


# --- Base: residenciais ou todas -----------------------------------------------------------


def test_base_e_so_residencial_quando_ha_uso_classificado(territorios, lote):
    a = territorios["a"]
    edificacao(lote, a, uso="residencial")
    edificacao(lote, a, dx=5, uso="nao_residencial")
    edificacao(lote, a, dx=10, uso="misto")
    edificacao(lote, a, dx=15, uso="")  # sem classificação
    regra.calcular()
    r = resultado(a)
    assert (r.base_edificacoes, r.edificacoes) == ("residenciais", 1)
    assert (
        r.metadados["edificacoes_no_bairro"] == 4 and r.metadados["edificacoes_classificadas"] == 3
    )


def test_sem_classificacao_a_base_e_todas_e_a_tela_declara(territorios, lote, cliente, revisor):
    a = territorios["a"]
    edificacao(lote, a, uso="")
    edificacao(lote, a, dx=5, uso="")
    regra.calcular()
    r = resultado(a)
    assert (r.base_edificacoes, r.edificacoes) == ("todas", 2)
    bloco = cliente.como(revisor).get(f"/api/v1/bairros/{a.id}/ficha").json()["regra_3_30_300"]
    assert bloco["base_edificacoes"] == "todas" and "todas as edificações" in bloco["base_texto"]


def test_bairro_sem_edificacoes_fica_sem_dado_nunca_zero(territorios, lote):
    edificacao(lote, territorios["a"])
    regra.calcular()
    b = resultado(territorios["b"])
    assert b.edificacoes == 0 and b.com_3_arvores is None and b.perto_de_area_verde is None
    partes = regra.partes_do_resultado(b)
    assert partes["3"].pct is None and partes["300"].pct is None


# --- "300": área verde a até 300 m ---------------------------------------------------------


def test_parte_300_area_verde_de_meio_hectare_conta_e_49_centesimos_nao(territorios, lote):
    a = territorios["a"]
    edificacao(lote, a)
    area_verde(poligono_m(100, 0, 49, 100), nome="Pequena")  # 4.900 m² (0,49 ha) a 100 m
    regra.calcular()
    assert resultado(a).perto_de_area_verde == 0
    area_verde(poligono_m(100, 200, 50.1, 100), nome="Grande")  # 5.010 m², perto
    regra.calcular()
    assert resultado(a).perto_de_area_verde == 1
    assert resultado(a).metadados["areas_verdes_de_meio_hectare"] == 1


def test_parte_300_distancia_ate_300_m_conta_e_alem_nao(territorios, lote):
    a = territorios["a"]
    edificacao(lote, a)
    edificacao(lote, a, dy=-1000)  # outra, longe da área verde
    area_verde(poligono_m(299.9, 0, 70, 80))  # borda a 299,9 m da primeira edificação
    regra.calcular()
    assert resultado(a).perto_de_area_verde == 1
    AreaVerde.objects.all().delete()
    area_verde(poligono_m(300.5, 0, 70, 80))  # borda a 300,5 m
    regra.calcular()
    assert resultado(a).perto_de_area_verde == 0


def test_parte_300_ignora_rotatoria_e_calcadao_mesmo_grandes(territorios, lote):
    a = territorios["a"]
    edificacao(lote, a)
    area_verde(poligono_m(50, 0, 100, 100), subtipo="rotatoria")
    area_verde(poligono_m(-200, 0, 100, 100), subtipo="calcadao")
    regra.calcular()
    assert resultado(a).perto_de_area_verde == 0
    area_verde(poligono_m(50, 50, 100, 100), tipo="parque", nome="Parque")
    regra.calcular()
    assert resultado(a).perto_de_area_verde == 1


def test_parte_300_usa_a_area_da_geometria_e_nao_a_informada_pela_fonte(territorios, lote):
    a = territorios["a"]
    edificacao(lote, a)
    v = area_verde(poligono_m(50, 0, 40, 100))  # 4.000 m²
    AreaVerde.objects.filter(pk=v.pk).update(area_m2=900_000)  # a fonte diz outra coisa
    regra.calcular()
    assert resultado(a).perto_de_area_verde == 0


# --- "30": cobertura vegetal pelo NDVI ------------------------------------------------------

OESTE, NORTE, PASSO = -38.57, -3.74, 0.001


def tiff_ndvi(valor_em, largura=50, altura=30) -> bytes:
    valores = [float(valor_em(i, j)) for j in range(altura) for i in range(largura)]
    raster = GDALRaster(
        {
            "name": "/vsimem/teste_ndvi.tif",
            "driver": "GTiff",
            "srid": 4326,
            "width": largura,
            "height": altura,
            "origin": [OESTE, NORTE],
            "scale": [PASSO, -PASSO],
            "datatype": 6,
            "nr_of_bands": 1,
            "bands": [{"data": valores, "nodata_value": -9999}],
        }
    )
    return bytes(raster.vsi_buffer)


def ndvi_de_teste():
    # Bairro A (colunas 10 a 19, linhas 10 a 19): 100 pixels. Os de linha < 3 têm NDVI 0,6 (30
    # pixels); linha 3: 0,4 exato (10 pixels, contam: "≥ limiar"); linha 4: 0,39 (não); linha 5:
    # sem medição; resto: 0,1. Bairro B (colunas 30 a 39): tudo 0,2. O resto é mar.
    def valor(i, j):
        if 10 <= i < 20 and 10 <= j < 20:
            linha = j - 10
            return {3: 0.4, 4: 0.39, 5: -9999}.get(linha, 0.6 if linha < 3 else 0.1)
        if 30 <= i < 40 and 10 <= j < 20:
            return 0.2
        return -9999

    return tiff_ndvi(valor)


@pytest.fixture
def com_ndvi(territorios, settings):
    settings.URBVERDE_GRAVAR_VALORES = True
    return territorios


def test_cobertura_vegetal_conta_pixels_a_partir_do_limiar_e_ignora_sem_medicao(com_ndvi):
    r = vegetacao.importar(ndvi_de_teste())
    a, b = com_ndvi["a"], com_ndvi["b"]
    ia = IndicadorTerritorialExterno.objects.get(territorio=a, indicador=vegetacao.INDICADOR)
    # 30 pixels a 0,6 + 10 a 0,4 (exato, conta) de 90 medidos (os 10 sem medição ficam fora).
    assert (ia.numerador, ia.denominador, float(ia.valor)) == (40, 90, 44.44)
    ib = IndicadorTerritorialExterno.objects.get(territorio=b, indicador=vegetacao.INDICADOR)
    assert (ib.numerador, ib.denominador) == (0, 100)
    assert "UrbVerde" in ia.fonte and "não só de copa" in ia.definicao and ia.unidade == "%"
    assert r.media_cidade == pytest.approx(100 * 40 / 190)


def test_limiar_do_ndvi_e_configuravel(com_ndvi, settings):
    settings.VEGETACAO_LIMIAR_NDVI = 0.5
    vegetacao.importar(ndvi_de_teste())
    ia = IndicadorTerritorialExterno.objects.get(
        territorio=com_ndvi["a"], indicador=vegetacao.INDICADOR
    )
    assert ia.numerador == 30  # o pixel de 0,4 já não conta
    vegetacao.importar(ndvi_de_teste(), limiar_ndvi=0.05)
    ia.refresh_from_db()
    assert ia.numerador == 90  # com limiar baixo, todos os medidos contam


def test_ndvi_so_grava_com_a_chave_da_urbverde_ligada(territorios, settings):
    settings.URBVERDE_GRAVAR_VALORES = False
    r = vegetacao.importar(ndvi_de_teste())
    assert (
        r.medidas
        and not IndicadorTerritorialExterno.objects.filter(indicador=vegetacao.INDICADOR).exists()
    )


def test_valor_fora_de_menos_1_a_1_nao_e_ndvi(com_ndvi):
    vegetacao.importar(tiff_ndvi(lambda i, j: 5.0 if 10 <= i < 20 and 10 <= j < 20 else -9999))
    assert not IndicadorTerritorialExterno.objects.filter(indicador=vegetacao.INDICADOR).exists()


def test_parte_30_entra_no_calculo_da_regra(com_ndvi, lote):
    edificacao(lote, com_ndvi["a"])
    vegetacao.importar(ndvi_de_teste())
    regra.calcular()
    r = resultado(com_ndvi["a"])
    assert (r.pixels_vegetacao, r.pixels_medidos) == (40, 90)
    assert regra.partes_do_resultado(r)["30"].pct == 44.4
    assert r.metadados["limiar_ndvi"] == 0.4
    assert resultado(com_ndvi["b"]).pixels_medidos == 100


def test_sem_ndvi_a_parte_30_fica_sem_dado(territorios, lote):
    edificacao(lote, territorios["a"])
    regra.calcular()
    r = resultado(territorios["a"])
    assert r.pixels_medidos is None and regra.partes_do_resultado(r)["30"].pct is None


# --- Selos, cidade e leitura ---------------------------------------------------------------


def test_selo_atende_na_meta_e_nao_atende_logo_abaixo(settings):
    assert regra.atende("30", 30.0) is True and regra.atende("30", 29.9) is False
    assert regra.atende("3", 100.0) is True and regra.atende("3", 99.9) is False
    assert regra.atende("300", 100.0) is True and regra.atende("300", 99.9) is False
    assert regra.atende("30", None) is None
    settings.REGRA_3_30_300_META_RESIDENCIAS_PCT = 80
    assert regra.atende("3", 80.0) is True and regra.atende("300", 79.9) is False


def test_cidade_soma_numeradores_e_denominadores_dos_bairros(territorios, lote):
    a, b = territorios["a"], territorios["b"]
    for dx in (0, 5, 10):
        edificacao(lote, a, dx=dx)
    edificacao(lote, b, dx=5000)  # no Bairro B (o rótulo do bairro é o que vale)
    for dx in (1, 2, 3):
        arvore(dx)  # as três edificações de A veem 3 árvores a até 30 m
    regra.calcular()
    # A: 3 de 3 (100%); B: 0 de 1. Cidade = 3 de 4 = 75%, e não a média 50% dos bairros.
    assert regra.cidade(regra.resultados(None, "todas"))["3"] == 75.0


def test_calcular_e_idempotente_no_dia_e_guarda_a_historia(territorios, lote):
    edificacao(lote, territorios["a"])
    regra.calcular(data=date(2026, 11, 1))
    regra.calcular(data=date(2026, 11, 1))
    regra.calcular(data=date(2026, 12, 1))
    assert (
        ResultadoRegra330300.objects.filter(bairro=territorios["a"], contagem="todas").count() == 2
    )
    assert {r.data for r in regra.resultados(None).values()} == {date(2026, 12, 1)}


def test_contagem_desconhecida_e_recusada():
    with pytest.raises(ValueError):
        regra.arvores_da_contagem("qualquer")


def test_comando_e_tarefa_calculam(territorios, lote):
    edificacao(lote, territorios["a"])
    saida = io.StringIO()
    call_command("calcular_3_30_300", stdout=saida)
    assert "Regra 3-30-300 de 2 bairro(s)" in saida.getvalue()
    assert calcular_3_30_300.run()["edificacoes"] == 1


# --- API: ficha, mapa coroplético, análises, planejamento ------------------------------------


@pytest.fixture
def calculado(territorios, lote):
    a = territorios["a"]
    for dx in (0, 5, 10, 15):
        edificacao(lote, a, dx=dx)
    for dx in (1, 2, 3):
        arvore(dx)
    area_verde(poligono_m(100, 0, 100, 100))
    regra.calcular()
    return territorios


def test_ficha_tem_o_bloco_3_30_300_com_tres_medidores_meta_cidade_e_selo(
    cliente, revisor, calculado
):
    corpo = cliente.como(revisor).get(f"/api/v1/bairros/{calculado['a'].id}/ficha").json()
    bloco = corpo["regra_3_30_300"]
    por_id = {p["id"]: p for p in bloco["partes"]}
    assert list(por_id) == ["3", "30", "300"]
    assert por_id["3"]["valor"] == 100.0 and por_id["3"]["atende"] is True
    assert (por_id["3"]["numerador"], por_id["3"]["denominador"]) == (4, 4)
    assert por_id["300"]["valor"] == 100.0 and por_id["300"]["cidade"] == 100.0
    assert por_id["30"]["sem_dado"] and por_id["30"]["atende"] is None
    assert "NDVI" in por_id["30"]["nota"]
    assert por_id["30"]["meta_pct"] == 30 and por_id["3"]["meta"] == "3 árvores a até 30 m"
    assert "Konijnendijk" in bloco["fonte_metodo"] and "euclidiana" in bloco["metodo"]
    assert bloco["base_edificacoes"] == "residenciais" and bloco["contagem"] == "todas"
    assert bloco["ressalva"] and bloco["rotulo_cidade"] == "Fortaleza"


def test_ficha_com_contagem_confirmadas_usa_so_as_confirmadas(cliente, revisor, calculado):
    Arvore.objects.update(confirmada=False)
    regra.calcular()
    url = f"/api/v1/bairros/{calculado['a'].id}/ficha"
    c = cliente.como(revisor)
    todas = c.get(url).json()["regra_3_30_300"]["partes"][0]["valor"]
    conf = c.get(url, {"contagem": "confirmadas"}).json()["regra_3_30_300"]
    assert (
        todas == 100.0 and conf["partes"][0]["valor"] == 0.0 and conf["contagem"] == "confirmadas"
    )


def test_ficha_do_bairro_sem_calculo_avisa_e_nao_inventa_numero(cliente, revisor, territorios):
    bloco = (
        cliente.como(revisor)
        .get(f"/api/v1/bairros/{territorios['a'].id}/ficha")
        .json()["regra_3_30_300"]
    )
    assert all(p["sem_dado"] and p["valor"] is None for p in bloco["partes"])
    assert "ainda não foi calculada" in bloco["partes"][0]["nota"]


def test_ficha_respeita_o_escopo(cliente, tecnico_a, calculado):
    c = cliente.como(tecnico_a)
    assert c.get(f"/api/v1/bairros/{calculado['a'].id}/ficha").status_code == 200
    assert c.get(f"/api/v1/bairros/{calculado['b'].id}/ficha").status_code == 403


def test_ficha_tem_cartoes_da_sefin_e_o_macrozoneamento(cliente, revisor, calculado):
    from itree.imoveis import sefin_bairros as sefin

    IndicadorTerritorialExterno.objects.create(
        territorio=calculado["a"],
        indicador=sefin.IPTU_MEDIO,
        valor=300,
        numerador=3000,
        denominador=10,
        unidade="R$",
        fonte="SEFIN",
        ingerido_em=timezone.now(),
        definicao="d",
        metodo="m",
    )
    corpo = cliente.como(revisor).get(f"/api/v1/bairros/{calculado['a'].id}/ficha").json()
    cartoes = {c["id"]: c for c in corpo["cartoes"]}
    assert cartoes["iptu_medio"]["valor"] == 300 and cartoes["iptu_medio"]["unidade"] == "R$"
    assert cartoes["iptu_inscricoes"]["sem_dado"] and cartoes["area_residencial"]["sem_dado"]
    assert corpo["macrozoneamento"] is None  # sem zonas importadas


def test_ficha_numero_de_consultas_nao_cresce_com_os_bairros(cliente, revisor, calculado, lote):
    c = cliente.como(revisor)
    url_a = f"/api/v1/bairros/{calculado['a'].id}/ficha"
    c.get(url_a)  # aquece caches
    with CaptureQueriesContext(connection) as antes:
        c.get(url_a)
    for i in range(6):
        b = criar_territorio(f"Extra {i}", geom=quadrado(-38.50 + i * 0.011, -3.76, 0.01))
        edificacao(lote, b, dx=9000 + i)
    regra.calcular()
    with CaptureQueriesContext(connection) as depois:
        c.get(url_a)
    assert len(depois) == len(antes)


def test_mapa_coropletico_traz_as_tres_partes_com_quebras_e_proveniencia(
    cliente, revisor, calculado
):
    corpo = cliente.como(revisor).get("/api/v1/indicadores/externos/populacao").json()
    ids = {i["id"] for i in corpo["indicadores"]}
    assert {"regra_3", "regra_30", "regra_300", "iptu_medio", "area_comercial"} <= ids
    a = next(f for f in corpo["features"] if f["properties"]["nome"] == "Bairro A")["properties"]
    assert (a["r3"], a["r300"], a["r30"]) == (100.0, 100.0, None)
    r3 = next(i for i in corpo["indicadores"] if i["id"] == "regra_3")
    assert r3["proveniencia"]["fonte_url"].startswith("https://doi.org/")
    assert "Konijnendijk" in r3["proveniencia"]["fonte"] and not r3["provisorio"]
    conf = cliente.como(revisor).get(
        "/api/v1/indicadores/externos/populacao", {"contagem": "confirmadas"}
    )
    assert conf.status_code == 200


def test_mapa_coropletico_numero_de_consultas_nao_cresce_com_os_bairros(
    cliente, revisor, calculado, lote
):
    c = cliente.como(revisor)
    c.get("/api/v1/indicadores/externos/populacao")
    with CaptureQueriesContext(connection) as antes:
        c.get("/api/v1/indicadores/externos/populacao")
    for i in range(6):
        b = criar_territorio(f"Mais {i}", geom=quadrado(-38.50 + i * 0.011, -3.76, 0.01))
        edificacao(lote, b, dx=9000 + i)
    regra.calcular()
    with CaptureQueriesContext(connection) as depois:
        c.get("/api/v1/indicadores/externos/populacao")
    assert len(depois) == len(antes)


def test_mapa_coropletico_respeita_o_escopo(cliente, tecnico_a, calculado):
    corpo = cliente.como(tecnico_a).get("/api/v1/indicadores/externos/populacao").json()
    assert [f["properties"]["nome"] for f in corpo["features"]] == ["Bairro A"]


def test_analises_tem_ranking_e_dispersao_das_tres_partes(cliente, revisor, calculado):
    IndicadorTerritorialExterno.objects.create(
        territorio=calculado["a"],
        indicador="renda_responsavel_media",
        valor=3000,
        numerador=3000,
        denominador=1,
        fonte="IBGE",
        ingerido_em=timezone.now(),
        definicao="d",
        metodo="m",
    )
    c = cliente.como(revisor)
    r = c.get("/api/v1/relatorios/analise", {"analise": "regra_300_por_bairro"}).json()
    assert r["unidade"] == "%" and r["total"] is None and not r["provisorio"]
    assert r["linhas"][0]["rotulo"] == "Bairro A" and r["linhas"][0]["valor"] == 100.0
    assert "Konijnendijk" in r["fonte"] and "300 m" in r["definicao"]
    d = c.get("/api/v1/relatorios/analise", {"analise": "regra_3_x_renda"}).json()
    assert d["dispersao"]["pontos"][0]["x"] == 3000 and d["dispersao"]["pontos"][0]["y"] == 100.0
    assert "regra 3-30-300" in d["dispersao"]["y_rotulo"]
    assert (
        c.get("/api/v1/relatorios/analise", {"analise": "regra_30_por_bairro"}).json()["linhas"]
        == []
    )
    sem = criar_usuario("sem@itree.teste", [])
    r = cliente.como(sem).get("/api/v1/relatorios/analise", {"analise": "regra_3_por_bairro"})
    assert r.status_code == 403


def test_planejamento_ganha_tres_criterios_da_regra(cliente, gestor_municipal, calculado):
    corpo = cliente.como(gestor_municipal).get("/api/v1/planejamento/criterios").json()
    criterios = {c["id"]: c for c in corpo["criterios"]}
    assert criterios["cobertura_vegetal"]["direcao"] == "baixo"
    assert not criterios["cobertura_vegetal"]["disponivel"]
    assert "NDVI" in criterios["cobertura_vegetal"]["motivo_indisponivel"]
    assert criterios["residentes_com_3_arvores"]["disponivel"]
    assert criterios["perto_de_area_verde"]["direcao"] == "baixo"
    a = next(b for b in corpo["bairros"] if b["nome"] == "Bairro A")
    assert a["valores"]["perto_de_area_verde"] == 100.0
    assert "3-30-300" in corpo["aviso"] and "DP-14" in corpo["aviso"]


def test_tela_nao_chama_de_provisorio_dp14_pendente_nos_indicadores_da_regra(
    cliente, revisor, calculado
):
    corpo = cliente.como(revisor).get("/api/v1/indicadores/externos/populacao").json()
    for i in corpo["indicadores"]:
        if i["id"].startswith("regra_"):
            assert not i["provisorio"] and not i["aviso"]
    mil = next(i for i in corpo["indicadores"] if i["id"] == "arvores_por_mil")
    assert "3-30-300" in mil["aviso"] and "ainda depende" not in mil["aviso"]
