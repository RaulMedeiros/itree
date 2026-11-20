"""Ilha de calor por bairro (UrbVerde): leitura do raster, média por bairro, licença e comando.

O raster dos testes é um GeoTIFF pequeno montado aqui (pixel de 0,001 grau): nenhum teste acessa a
rede. O valor real de Fortaleza foi conferido contra o GetFeatureInfo do próprio GeoServer.
"""

import io

import pytest
import responses
from django.contrib.gis.gdal import GDALRaster
from django.contrib.gis.geos import MultiPolygon, Polygon
from django.core.management import call_command
from django.core.management.base import CommandError

from itree.indicadores import ilha_calor
from itree.indicadores.models import IndicadorTerritorialExterno
from itree.indicadores.tasks import reimportar_ilha_calor

from .conftest import criar_territorio

pytestmark = pytest.mark.django_db

# Grade de 50 × 30 pixels de 0,001 grau, de (-38,57; -3,74) a (-38,52; -3,77).
OESTE, NORTE, PASSO = -38.57, -3.74, 0.001
LARGURA, ALTURA = 50, 30


def tiff(valor_em) -> bytes:
    """GeoTIFF Float32; ``valor_em(i, j)`` dá o valor do pixel (coluna i, linha j)."""
    valores = [float(valor_em(i, j)) for j in range(ALTURA) for i in range(LARGURA)]
    raster = GDALRaster(
        {
            "name": "/vsimem/teste_ilha_calor.tif",
            "driver": "GTiff",
            "srid": 4326,
            "width": LARGURA,
            "height": ALTURA,
            "origin": [OESTE, NORTE],
            "scale": [PASSO, -PASSO],
            "datatype": 6,
            "nr_of_bands": 1,
            "bands": [{"data": valores, "nodata_value": -9999}],
        }
    )
    return bytes(raster.vsi_buffer)


def x_do_pixel(i):
    return OESTE + (i + 0.5) * PASSO


@pytest.fixture
def dois_bairros(db):
    a = criar_territorio(
        "Bairro A", geom=MultiPolygon(Polygon.from_bbox((-38.56, -3.76, -38.55, -3.75)), srid=4326)
    )
    b = criar_territorio(
        "Bairro B", geom=MultiPolygon(Polygon.from_bbox((-38.54, -3.76, -38.53, -3.75)), srid=4326)
    )
    return a, b


def raster_padrao():
    # Bairro A (colunas 10 a 19): +2 °C, com 5 pixels sem medição (-9999) e 5 com dado ausente
    # (100). Bairro B (colunas 30 a 39): -1 °C. O resto é mar: sem medição.
    def valor(i, j):
        if 10 <= i < 20 and 10 <= j < 20:
            linha = j - 10
            if linha == 0 and i < 15:
                return -9999
            if linha == 1 and i < 15:
                return 100
            return 2.0
        if 30 <= i < 40 and 10 <= j < 20:
            return -1.0
        return -9999

    return tiff(valor)


def test_media_dos_pixels_medidos_e_cobertura_por_bairro(dois_bairros):
    r = ilha_calor.calcular(ilha_calor.ler_grade(raster_padrao()))
    a, b = dois_bairros
    ma, mb = r.medidas[str(a.pk)], r.medidas[str(b.pk)]
    assert (ma.total, ma.validos) == (100, 90)  # 10 pixels sem valor útil não entram
    assert ma.media == pytest.approx(2.0) and ma.cobertura == pytest.approx(0.9)
    assert (mb.total, mb.validos) == (100, 100) and mb.media == pytest.approx(-1.0)
    # Média da cidade ponderada pelos pixels medidos (não a média das médias).
    assert r.media_cidade == pytest.approx((2.0 * 90 - 1.0 * 100) / 190)


def test_pixel_so_conta_se_o_centro_esta_dentro_do_bairro_e_buracos_ficam_de_fora(db):
    externo = Polygon.from_bbox((-38.56, -3.76, -38.55, -3.75))
    buraco = Polygon.from_bbox((-38.5570, -3.7580, -38.5520, -3.7530))
    furado = MultiPolygon(
        Polygon(externo.exterior_ring.coords, buraco.exterior_ring.coords), srid=4326
    )
    t = criar_territorio("Furado", geom=furado)
    grade = ilha_calor.ler_grade(raster_padrao())
    medida = ilha_calor.medir(t.geom, grade)
    # 10 × 10 pixels no quadrado; o buraco (5 × 5 centros) leva 25 embora.
    assert medida.total == 100 - 25


def test_sem_pixel_medido_nao_ha_valor(db):
    criar_territorio(
        "No mar",
        geom=MultiPolygon(Polygon.from_bbox((-38.5695, -3.7695, -38.5605, -3.7605)), srid=4326),
    )
    r = ilha_calor.calcular(ilha_calor.ler_grade(raster_padrao()))
    assert r.medidas == {} and r.media_cidade is None and r.sem_medicao == ["No mar"]


def test_so_grava_com_a_licenca_confirmada(dois_bairros, settings):
    settings.URBVERDE_GRAVAR_VALORES = False
    resultado = ilha_calor.importar(raster_padrao())
    assert len(resultado.medidas) == 2 and resultado.gravados == 0
    assert not IndicadorTerritorialExterno.objects.filter(indicador=ilha_calor.INDICADOR).exists()


def test_grava_valor_com_fonte_ano_metodo_e_licenca_e_e_idempotente(dois_bairros, settings):
    settings.URBVERDE_GRAVAR_VALORES = True
    a, b = dois_bairros
    ilha_calor.importar(raster_padrao())
    ilha_calor.importar(raster_padrao())
    linhas = IndicadorTerritorialExterno.objects.filter(indicador=ilha_calor.INDICADOR)
    assert linhas.count() == 2
    i = linhas.get(territorio=a)
    assert float(i.valor) == 2.0 and i.unidade == "°C"
    assert (i.numerador, i.denominador) == (90, 100)
    assert i.data_referencia.year == 2025 and "UrbVerde" in i.fonte
    assert "média dos pixels" in i.metodo and "mediana" in i.definicao
    assert "vedado o uso comercial" in i.licenca
    assert ilha_calor.media_da_cidade() == {
        "valor": pytest.approx((2.0 * 90 - 1.0 * 100) / 190, abs=0.01),
        "bairros": 2,
    }

    # Reimportação anual: bairro que perdeu a medição some, em vez de ficar com valor velho.
    ilha_calor.importar(tiff(lambda i, j: 3.0 if 10 <= i < 20 and 10 <= j < 20 else -9999))
    restante = IndicadorTerritorialExterno.objects.filter(indicador=ilha_calor.INDICADOR)
    assert [(x.territorio_id, float(x.valor)) for x in restante] == [(a.pk, 3.0)]
    assert not restante.filter(territorio=b).exists()


def test_raster_ilegivel(dois_bairros):
    with pytest.raises(ilha_calor.RasterInvalido):
        ilha_calor.ler_grade(b"nao e um tiff")


@responses.activate
def test_comando_baixa_o_recorte_pelo_wcs_e_avisa_que_nao_gravou(dois_bairros, settings):
    settings.URBVERDE_GRAVAR_VALORES = False
    responses.get(ilha_calor.URL_WCS, body=raster_padrao(), content_type="image/tiff")
    saida = io.StringIO()
    call_command("importar_ilha_calor_urbverde", "--bairros", "Bairro A", stdout=saida)
    chamada = responses.calls[0].request.url
    assert ilha_calor.COBERTURA in chamada and "GetCoverage" in chamada
    assert "Long%28" in chamada or "Long(" in chamada
    texto = saida.getvalue()
    assert "Bairro A: +2.00 °C" in texto and "Bairro B" not in texto
    assert "Nada foi gravado" in texto
    assert IndicadorTerritorialExterno.objects.count() == 0


@responses.activate
def test_comando_grava_quando_permitido(dois_bairros, settings):
    settings.URBVERDE_GRAVAR_VALORES = True
    responses.get(ilha_calor.URL_WCS, body=raster_padrao(), content_type="image/tiff")
    saida = io.StringIO()
    call_command("importar_ilha_calor_urbverde", stdout=saida)
    assert "2 valor(es) gravado(s)" in saida.getvalue()
    assert IndicadorTerritorialExterno.objects.filter(indicador=ilha_calor.INDICADOR).count() == 2


@responses.activate
def test_comando_recusa_resposta_que_nao_e_geotiff(dois_bairros):
    responses.get(ilha_calor.URL_WCS, body="<html>erro</html>", content_type="text/html")
    with pytest.raises(CommandError, match="GeoTIFF"):
        call_command("importar_ilha_calor_urbverde")


def test_comando_sem_bairros_pede_os_limites(db):
    with pytest.raises(CommandError, match="importe os limites"):
        call_command("importar_ilha_calor_urbverde")


@responses.activate
def test_tarefa_anual_roda_o_comando_e_propaga_a_falha(dois_bairros, settings):
    settings.URBVERDE_GRAVAR_VALORES = True
    responses.get(ilha_calor.URL_WCS, body=raster_padrao(), content_type="image/tiff")
    reimportar_ilha_calor()
    assert IndicadorTerritorialExterno.objects.filter(indicador=ilha_calor.INDICADOR).count() == 2
    responses.replace(responses.GET, ilha_calor.URL_WCS, status=503)
    with pytest.raises(CommandError):
        reimportar_ilha_calor()
    # A falha não apaga o que já havia.
    assert IndicadorTerritorialExterno.objects.filter(indicador=ilha_calor.INDICADOR).count() == 2


def test_beat_agenda_a_reimportacao_anual(settings):
    agenda = settings.CELERY_BEAT_SCHEDULE["reimportar-ilha-calor"]
    assert agenda["task"] == "itree.indicadores.tasks.reimportar_ilha_calor"
    assert agenda["schedule"].month_of_year == {2}
