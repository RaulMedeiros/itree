"""Focos de calor próximos a parques e unidades de conservação (T-05, W-08).

O foco é gravado com o parque ou a unidade a até o raio configurado (padrão 1 km),
mesmo fora do município. O escopo dos focos ganha o mesmo buffer; o dos demais
alertas, não.
"""

import pytest
from django.contrib.gis.geos import MultiPolygon, Point, Polygon
from django.utils import timezone

from itree.alertas import fontes
from itree.alertas.escopo import alerta_no_escopo
from itree.alertas.models import AlertaAmbiental, TipoAlerta
from itree.alertas.proximidade import area_verde_proxima
from itree.areas_verdes.models import AreaVerde

from .conftest import com_escopo, criar_territorio, criar_usuario

pytestmark = pytest.mark.django_db

# Município: x de -38,60 a -38,50 e y de -3,80 a -3,70 (grau a grau, em Fortaleza ~111 km).
MUNICIPIO = (-38.60, -3.80, -38.50, -3.70)
# Parque logo a leste do limite; foco dentro do município a 0,005 grau (cerca de 0,6 km).
PARQUE = (-38.495, -3.78, -38.485, -3.77)
PRACA = (-38.58, -3.725, -38.57, -3.715)


def _multi(caixa) -> MultiPolygon:
    return MultiPolygon(Polygon.from_bbox(caixa), srid=4326)


def _area(tipo, nome, caixa, codigo):
    return AreaVerde.objects.create(
        tipo=tipo,
        nome=nome,
        codigo_externo=codigo,
        geom=_multi(caixa),
        fonte="Teste",
        ingerido_em=timezone.now(),
    )


@pytest.fixture
def cenario(db):
    municipio = criar_territorio("Fortaleza", tipo="municipio", geom=_multi(MUNICIPIO))
    parque = _area("parque", "Parque Estadual do Cocó", PARQUE, "1")
    _area("praca", "Praça do Teste", PRACA, "2")
    return municipio, parque


def _csv(*focos) -> bytes:
    linhas = ["id,lat,lon,data_hora_gmt,satelite"]
    linhas += [f"{i},{lat},{lon},2026-11-09 03:04:00,NOAA-21" for i, lon, lat in focos]
    return "\n".join(linhas).encode()


def _ingerir(*focos):
    return fontes.ingerir("inpe_focos", _csv(*focos), "teste.csv")


def test_foco_perto_do_parque_dentro_do_municipio_guarda_a_area_e_a_distancia(cenario):
    r = _ingerir(("perto", -38.5005, -3.775))
    assert r.sucesso, r.erro
    proxima = AlertaAmbiental.objects.get(id_externo="perto").area_verde_proxima
    assert proxima["nome"] == "Parque Estadual do Cocó"
    assert proxima["tipo"] == "parque" and proxima["tipo_rotulo"] == "Parque urbano"
    assert 550 <= proxima["distancia_m"] <= 650  # cerca de 0,6 km


def test_foco_longe_de_area_verde_fica_sem_o_registro(cenario):
    _ingerir(("longe", -38.55, -3.72))
    assert AlertaAmbiental.objects.get(id_externo="longe").area_verde_proxima is None


def test_praca_nao_conta_como_area_verde_proxima(cenario):
    _ingerir(("na_praca", -38.575, -3.72))
    assert AlertaAmbiental.objects.get(id_externo="na_praca").area_verde_proxima is None


def test_foco_dentro_do_parque_tem_distancia_zero(cenario):
    _ingerir(("dentro", -38.493, -3.775))
    assert AlertaAmbiental.objects.get(id_externo="dentro").area_verde_proxima["distancia_m"] == 0


def test_foco_fora_do_municipio_so_entra_se_estiver_junto_de_area_verde(cenario):
    r = _ingerir(
        ("no_parque", -38.4925, -3.775),  # fora do município (cerca de 0,8 km), dentro do parque
        ("sem_parque", -38.495, -3.72),  # no buffer do município, longe de qualquer parque
        ("distante", -38.40, -3.775),  # além do buffer
    )
    assert (r.recebidos, r.novos, r.fora_do_municipio) == (3, 1, 2)
    assert AlertaAmbiental.objects.get().id_externo == "no_parque"


def test_raio_vem_da_configuracao(cenario, settings):
    settings.ALERTAS_FOCOS_RAIO_AREA_VERDE_KM = 0.3
    r = _ingerir(("perto", -38.5005, -3.775), ("fora", -38.4925, -3.775))
    # A 0,6 km do parque, o foco do município deixa de ser "próximo"; o de fora cai do buffer.
    assert AlertaAmbiental.objects.get(id_externo="perto").area_verde_proxima is None
    assert (r.novos, r.fora_do_municipio) == (1, 1)


def test_reingerir_continua_idempotente(cenario):
    _ingerir(("fora", -38.4925, -3.775))
    r = _ingerir(("fora", -38.4925, -3.775))
    assert (r.novos, r.ja_existentes) == (0, 1)
    assert AlertaAmbiental.objects.count() == 1


def test_area_mais_proxima_vence_e_unidade_de_conservacao_tambem_conta(cenario):
    _area("unidade_conservacao", "APA Teste", (-38.5, -3.775, -38.4995, -3.7745), "3")
    proxima = area_verde_proxima(Point(-38.5005, -3.775, srid=4326), 1.0)
    assert proxima["nome"] == "APA Teste" and proxima["distancia_m"] < 100


def test_api_do_alerta_traz_a_area_verde_proxima(cenario, cliente):
    municipio, _ = cenario
    _ingerir(("perto", -38.5005, -3.775))
    gestor = com_escopo(criar_usuario("g@itree.teste", ["gestor"]), municipio)
    alerta = AlertaAmbiental.objects.get()
    corpo = cliente.como(gestor).get(f"/api/v1/alertas/{alerta.id}").json()
    assert corpo["area_verde_proxima"]["nome"] == "Parque Estadual do Cocó"


def test_escopo_dos_focos_tem_buffer_e_o_dos_outros_alertas_nao(cenario, cliente):
    municipio, _ = cenario
    gestor = com_escopo(criar_usuario("g@itree.teste", ["gestor"]), municipio)
    fora = Point(-38.4925, -3.775, srid=4326)  # cerca de 0,8 km do limite
    comuns = {"id_externo": "x", "geom": fora, "data_deteccao": timezone.now()}
    foco = AlertaAmbiental.objects.create(
        fonte="inpe_focos", tipo=TipoAlerta.FOCO_CALOR, **{**comuns, "id_externo": "foco"}
    )
    supressao = AlertaAmbiental.objects.create(
        fonte="inpe_deter", tipo=TipoAlerta.SUPRESSAO, **{**comuns, "id_externo": "supressao"}
    )
    assert alerta_no_escopo(foco, gestor) and not alerta_no_escopo(supressao, gestor)
    lista = cliente.como(gestor).get("/api/v1/alertas", {"status": "todos"}).json()
    assert [a["id_externo"] for a in lista["results"]] == ["foco"]


def test_mapa_de_alertas_respeita_o_buffer(cenario, cliente):
    municipio, _ = cenario
    gestor = com_escopo(criar_usuario("g@itree.teste", ["gestor"]), municipio)
    _ingerir(("fora", -38.4925, -3.775))
    mapa = cliente.como(gestor).get("/api/v1/mapa/alertas")
    assert mapa.status_code == 200
    assert len(mapa.json()["features"]) == 1
