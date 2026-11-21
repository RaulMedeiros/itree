"""Imóveis e uso do solo: edificações (Open Buildings), uso por lote (SEFIN), macrozoneamento
(SEUMA) e indicadores da SEFIN por bairro. Arquivos pequenos montados aqui; nada acessa a rede."""

import gzip
import json

import pytest
from django.contrib.gis.geos import Point, Polygon
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from itree.imoveis import edificacoes, macrozoneamento, uso_lotes
from itree.imoveis import sefin_bairros as sefin
from itree.imoveis.models import Edificacao, LoteUsoSolo, Macrozona
from itree.indicadores.models import IndicadorTerritorialExterno

from .conftest import PONTO_A, PONTO_B, criar_territorio, criar_usuario, quadrado
from .mvt_util import decodificar
from .test_iluminacao_conflito import _tile

pytestmark = pytest.mark.django_db


def csv_edificacoes(tmp_path, linhas, nome="celula.csv.gz", cabecalho=False):
    texto = ""
    if cabecalho:
        texto += "latitude,longitude,area_in_meters,confidence,geometry,full_plus_code\n"
    for lat, lon, area, conf, wkt in linhas:
        texto += f'{lat},{lon},{area},{conf},"{wkt}",PLUS+{abs(hash((lat, lon))) % 1000}\n'
    caminho = tmp_path / nome
    caminho.write_bytes(gzip.compress(texto.encode()))
    return caminho


def quadrado_wkt(lon, lat, lado=0.00005):
    return (
        f"POLYGON(({lon} {lat}, {lon + lado} {lat}, {lon + lado} {lat + lado}, "
        f"{lon} {lat + lado}, {lon} {lat}))"
    )


def linha(lon, lat, area=80.0, conf=0.9, wkt=None):
    return (lat + 0.000025, lon + 0.000025, area, conf, wkt or quadrado_wkt(lon, lat))


# --- Edificações -----------------------------------------------------------------------


def test_importa_recorta_pelo_municipio_e_descarta_o_invalido(tmp_path, territorios):
    arquivo = csv_edificacoes(
        tmp_path,
        [
            linha(PONTO_A["longitude"], PONTO_A["latitude"]),
            linha(PONTO_B["longitude"], PONTO_B["latitude"], conf=0.5),
            linha(-38.0, -3.75),  # fora do município
            linha(-38.575, -3.77, area=2_000_000),  # área absurda
            linha(-38.575, -3.77, conf=1.5),  # confiança fora de 0 a 1
            linha(-38.575, -3.77, wkt="POINT(-38.575 -3.77)"),  # não é polígono
            (-3.77, "x", 10, 0.5, quadrado_wkt(-38.575, -3.77)),  # número ilegível
        ],
    )
    r = edificacoes.importar(arquivo)
    assert r.importadas == 2 and r.leitura.linhas_lidas == 7
    assert r.leitura.fora_do_municipio == 1 and r.leitura.invalidas == 4
    por_bairro = {e.bairro.nome: e for e in Edificacao.objects.select_related("bairro")}
    assert set(por_bairro) == {"Bairro A", "Bairro B"}
    e = por_bairro["Bairro A"]
    assert e.geom.contains(e.centro) and e.fonte == "open_buildings" and e.uso == ""
    assert "CC BY 4.0" in e.lote.licenca and e.lote.importadas == 2


def test_reimportar_troca_as_edificacoes_e_respeita_a_confianca_minima(tmp_path, territorios):
    a = csv_edificacoes(tmp_path, [linha(PONTO_A["longitude"], PONTO_A["latitude"])], "a.csv.gz")
    edificacoes.importar(a)
    outro = csv_edificacoes(
        tmp_path,
        [
            linha(PONTO_A["longitude"], PONTO_A["latitude"], conf=0.9),
            linha(PONTO_A["longitude"] + 0.001, PONTO_A["latitude"], conf=0.3),
        ],
        "b.csv.gz",
        cabecalho=True,
    )
    r = edificacoes.importar(outro, confianca_minima=0.5)
    assert Edificacao.objects.count() == 1 and r.leitura.abaixo_da_confianca == 1
    assert Edificacao.objects.get().lote_id == r.lote.pk  # só o último lote tem edificações


def test_carga_em_lote_tem_numero_fixo_de_consultas(tmp_path, territorios):
    def muitas(n):
        return csv_edificacoes(
            tmp_path,
            [linha(-38.559 + (i % 100) * 0.00008, -3.759 + (i // 100) * 0.00008) for i in range(n)],
            f"{n}.csv.gz",
        )

    with CaptureQueriesContext(connection) as pequeno:
        edificacoes.importar(muitas(10))
    with CaptureQueriesContext(connection) as grande:
        r = edificacoes.importar(muitas(600))
    assert r.importadas == 600
    assert len(grande) <= len(pequeno) + 2


def test_baixar_so_aceita_o_host_do_open_buildings(tmp_path):
    with pytest.raises(edificacoes.ArquivoInvalido):
        edificacoes.baixar(tmp_path / "x", "https://exemplo.com/a.csv.gz")
    with pytest.raises(edificacoes.ArquivoInvalido):
        edificacoes.baixar(tmp_path / "x", "http://storage.googleapis.com/a.csv.gz")


def test_sem_limites_importados_nao_importa(tmp_path):
    arquivo = csv_edificacoes(tmp_path, [linha(-38.555, -3.755)])
    with pytest.raises(edificacoes.ArquivoInvalido):
        edificacoes.importar(arquivo)


# --- Uso predominante por lote (SEFIN, WMS) --------------------------------------------


def feicao_lote(id_, uso, x0, y0, lado=0.0005, **props):
    anel = [[x0, y0], [x0 + lado, y0], [x0 + lado, y0 + lado], [x0, y0 + lado], [x0, y0]]
    return {
        "type": "Feature",
        "geometry": {"type": "MultiPolygon", "coordinates": [[anel]]},
        "properties": {
            "id": id_,
            "uso_solo": uso,
            "qtd_unidad": 2,
            "qtd_reside": 2,
            "qtd_nao_re": 0,
            "area_edif_": 120.5,
            "area_edi_1": 0,
            **props,
        },
    }


def test_lote_da_feicao_le_os_atributos_e_descarta_o_invalido():
    agora = timezone.now()
    lote = uso_lotes.lote_da_feicao(feicao_lote(7, "Não Residencial", -38.55, -3.75), "c", agora)
    assert lote.uso == "nao_residencial" and lote.unidades == 2 and lote.id_fonte == 7
    assert lote.area_residencial_m2 == 120.5 and lote.geom.geom_type == "MultiPolygon"
    assert uso_lotes.lote_da_feicao(feicao_lote(1, "Outro", -38.55, -3.75), "c", agora) is None
    assert (
        uso_lotes.lote_da_feicao({"properties": {"id": 1, "uso_solo": "Misto"}}, "c", agora) is None
    )
    assert uso_lotes.lote_da_feicao(feicao_lote("x", "Misto", -38.55, -3.75), "c", agora) is None


def test_colheita_grava_sem_repetir_divide_o_truncado_e_classifica(
    tmp_path, territorios, monkeypatch
):
    edificacoes.importar(
        csv_edificacoes(
            tmp_path,
            [
                linha(-38.5575, -3.7575),  # dentro do lote 1 (residencial)
                linha(-38.5545, -3.7575),  # dentro do lote 2 (não residencial)
                linha(-38.5500, -3.7500),  # fora de qualquer lote
            ],
        )
    )
    lote1 = feicao_lote(1, "Residencial", -38.558, -3.758, 0.002)
    lote2 = feicao_lote(2, "Não Residencial", -38.555, -3.758, 0.002)
    chamadas = []

    def falsa(camada, oeste, sul, leste, norte):
        chamadas.append((oeste, sul, leste, norte))
        return [lote1, lote2]  # o mesmo par em todo quadrado: tem de gravar uma vez só

    monkeypatch.setattr(uso_lotes, "LADO_GRAUS", 0.01)
    regional = territorios["a"].geom
    c = uso_lotes.colher_regional(2, regional, consulta=falsa, pausa=0)
    assert LoteUsoSolo.objects.count() == 2 and c.descartados == 0 and not c.falhas
    assert c.requisicoes == len(chamadas) >= 1

    # Resposta no limite de feições: o quadrado é dividido em quatro, e a resposta truncada é
    # descartada.
    monkeypatch.setattr(uso_lotes, "LIMITE_FEICOES", 2)
    visitas = []

    def truncada(camada, oeste, sul, leste, norte):
        visitas.append(leste - oeste)
        return [lote1, lote2] if (leste - oeste) > 0.0055 else []

    LoteUsoSolo.objects.all().delete()
    c2 = uso_lotes.colher_regional(2, regional, consulta=truncada, pausa=0)
    assert c2.truncadas == 1 and min(visitas) < max(visitas)

    monkeypatch.setattr(uso_lotes, "LIMITE_FEICOES", 3000)
    # Classificação pelo lote que contém o centro; o que ficou fora segue sem uso.
    uso_lotes.colher_regional(2, regional, consulta=falsa, pausa=0)
    r = uso_lotes.classificar_edificacoes()
    usos = sorted(Edificacao.objects.values_list("uso", flat=True))
    assert usos == ["", "nao_residencial", "residencial"]
    assert (
        r["classificadas"] == 2 and r["edificacoes"] == 3 and r["cobertura"] == pytest.approx(2 / 3)
    )


def test_consulta_so_fala_com_o_mapas_e_falha_com_resposta_ruim(monkeypatch):
    with pytest.raises(uso_lotes.ErroWms):
        uso_lotes.consultar("x", 0, 0, 1, 1, url="https://exemplo.com/ows")
    monkeypatch.setattr(uso_lotes.time, "sleep", lambda s: None)

    class Resposta:
        def raise_for_status(self):
            pass

        def json(self):
            return {"sem": "feicoes"}

    monkeypatch.setattr(uso_lotes.requests, "get", lambda *a, **k: Resposta())
    with pytest.raises(uso_lotes.ErroWms):
        uso_lotes.consultar("vw_UsoPorLoteSER1", -38.6, -3.8, -38.5, -3.7)


# --- Macrozoneamento -------------------------------------------------------------------

DESCRICAO = (
    "<b>Zona de Ocupação Preferencial 1</b> \n\n<p></p> <i>Taxa de Permeabilidade: <b>\t30\n</b>"
    "<p></p> <i>Taxa de Ocupação do Solo: <b>\t60\n</b><p></p> <i>Altura Máxima: <b>\t48\n</b>"
)


def geojson_macrozona(com_z=False):
    def anel(x0, y0, lado):
        pts = [[x0, y0], [x0 + lado, y0], [x0 + lado, y0 + lado], [x0, y0 + lado], [x0, y0]]
        return [[*p, 0] if com_z else p for p in pts]

    def f(id_, nome, x0, descr=""):
        return {
            "type": "Feature",
            "geometry": {"type": "MultiPolygon", "coordinates": [[anel(x0, -3.76, 0.01)]]},
            "properties": {"id": id_, "nome": nome, "descricao": descr, "fracao_lote": 100},
        }

    return json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                f(1, "Zona de Ocupação Preferencial 1", -38.56, DESCRICAO),
                f(2, "Zona de Orla - Trecho I", -38.54),
            ],
        }
    ).encode()


def test_importa_zonas_com_sigla_parametros_e_geometria_2d():
    r = macrozoneamento.importar(geojson_macrozona(com_z=True))
    assert r == {"zonas": 2, "removidas": 0}
    zop = Macrozona.objects.get(codigo_fonte=1)
    assert zop.sigla == "ZOP 1" and not zop.geom.hasz
    assert zop.parametros["Taxa de Permeabilidade"] == "30"
    assert zop.parametros["Altura Máxima"] == "48" and "SEUMA" in zop.fonte
    assert Macrozona.objects.get(codigo_fonte=2).sigla == "ZO"
    # Reimportar atualiza e remove a zona que saiu da fonte.
    outro = json.loads(geojson_macrozona())
    outro["features"].pop()
    assert macrozoneamento.importar(json.dumps(outro).encode()) == {"zonas": 1, "removidas": 1}


def test_arquivo_sem_zonas_e_recusado():
    with pytest.raises(macrozoneamento.FonteInvalida):
        macrozoneamento.importar(b'{"features": []}')
    with pytest.raises(macrozoneamento.FonteInvalida):
        macrozoneamento.importar(b"nao e json")


def test_partilha_do_bairro_por_zona(territorios):
    macrozoneamento.importar(geojson_macrozona())
    # O Bairro A (-38,56 a -38,55) está inteiro na ZOP 1; o B (-38,54 a -38,53), na zona de orla.
    a = macrozoneamento.partilha_do_bairro(territorios["a"].pk)
    assert [(z["sigla"], z["pct"]) for z in a] == [("ZOP 1", 100.0)]
    assert macrozoneamento.partilha_do_bairro(territorios["b"].pk)[0]["sigla"] == "ZO"


def test_endpoint_da_zona_por_ponto_e_por_arvore_com_escopo(
    cliente, revisor, tecnico_a, territorios
):
    from itree.inventario.models import Arvore

    macrozoneamento.importar(geojson_macrozona())
    c = cliente.como(revisor)
    r = c.get(
        "/api/v1/macrozoneamento/zona", {"lat": PONTO_A["latitude"], "lon": PONTO_A["longitude"]}
    )
    assert r.status_code == 200 and r.json()["zona"]["sigla"] == "ZOP 1"
    assert "SEUMA" in r.json()["fonte"]
    fora = c.get("/api/v1/macrozoneamento/zona", {"lat": -3.76 + 0.05, "lon": -38.56 + 0.01})
    assert fora.status_code == 200 and fora.json()["zona"] is None
    arvore = Arvore.objects.create(
        origem_registro="importacao",
        localizacao_origem="importada",
        geom=Point(PONTO_A["longitude"], PONTO_A["latitude"], srid=4326),
    )
    assert (
        c.get("/api/v1/macrozoneamento/zona", {"arvore": str(arvore.pk)}).json()["zona"]["sigla"]
        == "ZOP 1"
    )
    # Escopo e validação.
    tec = cliente.como(tecnico_a)
    assert (
        tec.get(
            "/api/v1/macrozoneamento/zona",
            {"lat": PONTO_B["latitude"], "lon": PONTO_B["longitude"]},
        ).status_code
        == 403
    )
    assert tec.get("/api/v1/macrozoneamento/zona", {"lat": "x", "lon": "y"}).status_code == 400
    sem = criar_usuario("sem@itree.teste", [])
    assert (
        cliente.como(sem).get("/api/v1/macrozoneamento/zona", {"lat": 0, "lon": 0}).status_code
        == 403
    )


# --- Indicadores da SEFIN por bairro ------------------------------------------------------


def geojson_sefin(propriedades):
    return json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "geometry": None, "properties": p} for p in propriedades
            ],
        }
    ).encode()


def test_iptu_e_areas_por_bairro_casam_pelo_nome_e_sem_casamento_e_relatado(db):
    criar_territorio("Aldeota", geom=quadrado(-38.56, -3.76, 0.01))
    criar_territorio("Centro", geom=quadrado(-38.54, -3.76, 0.01))
    iptu = geojson_sefin(
        [
            {
                "Bairro": "ALDEOTA",
                "Quantidade de inscrições": 10,
                "Média do valor do imposto devido": 250.5,
                "Total do valor do imposto devido": 2505.0,
            },
            {
                "Bairro": "DENDÊ",
                "Quantidade de inscrições": 3,
                "Média do valor do imposto devido": 1,
                "Total do valor do imposto devido": 3,
            },
        ]
    )
    r = sefin.importar(sefin.IPTU_MEDIO, iptu)
    assert (
        r["gravados"] == 1
        and r["sem_casamento"] == ["DENDÊ"]
        and r["bairros_sem_dado"] == ["Centro"]
    )
    i = IndicadorTerritorialExterno.objects.get(indicador=sefin.IPTU_MEDIO)
    assert (float(i.valor), i.numerador, i.denominador, i.unidade) == (250.5, 2505, 10, "R$")
    assert "SEFIN" in i.fonte and i.data_referencia.year == 2024 and i.definicao and i.metodo
    areas = geojson_sefin([{"bairro": "CENTRO", "areas_2021": 1234.6, "inscr_2021": 7}])
    sefin.importar(sefin.AREA_RESIDENCIAL, areas)
    a = IndicadorTerritorialExterno.objects.get(indicador=sefin.AREA_RESIDENCIAL)
    assert (a.numerador, a.denominador, a.territorio.nome) == (1235, 7, "Centro")


def test_arquivo_sefin_ilegivel_ou_vazio_e_recusado():
    with pytest.raises(sefin.FonteInvalida):
        sefin.importar(sefin.IPTU_MEDIO, b"lixo")
    with pytest.raises(sefin.FonteInvalida):
        sefin.importar(sefin.AREA_COMERCIAL, geojson_sefin([{"bairro": "X"}]))


# --- Camada MVT ---------------------------------------------------------------------------


def edificacao(centro, bairro=None, uso="", lado=0.00004):
    from itree.imoveis.models import LoteEdificacoes

    lote = LoteEdificacoes.objects.first() or LoteEdificacoes.objects.create(
        fonte="open_buildings", fonte_texto="t", ingerido_em=timezone.now()
    )
    x, y = centro
    geom = Polygon.from_bbox((x - lado, y - lado, x + lado, y + lado))
    geom.srid = 4326
    return Edificacao.objects.create(
        lote=lote,
        fonte="open_buildings",
        geom=geom,
        centro=Point(x, y, srid=4326),
        area_m2=90,
        confianca=0.8,
        bairro=bairro,
        uso=uso,
    )


def test_tile_de_edificacoes_so_a_partir_do_zoom_15_e_com_escopo(
    cliente, revisor, tecnico_a, territorios
):
    edificacao((PONTO_A["longitude"], PONTO_A["latitude"]), territorios["a"], "residencial")
    edificacao((PONTO_B["longitude"], PONTO_B["latitude"]), territorios["b"])

    def pegar(usuario, z, ponto):
        x, y = _tile(ponto["longitude"], ponto["latitude"], z)
        r = cliente.como(usuario).get(f"/api/v1/mapa/tiles/edificacoes/{z}/{x}/{y}")
        assert r.status_code == 200
        return r, decodificar(r.content, z, x, y).get("edificacoes", [])

    resposta, feicoes = pegar(revisor, 17, PONTO_A)
    assert resposta["Content-Type"] == "application/vnd.mapbox-vector-tile"
    assert len(feicoes) == 1
    assert (feicoes[0]["props"]["uso"], feicoes[0]["props"]["area_m2"]) == ("residencial", 90)
    assert feicoes[0]["props"]["confianca_pct"] == 80
    assert pegar(revisor, 15, PONTO_A)[1]
    for z in (14, 10):
        assert pegar(revisor, z, PONTO_A)[0].content == b""
    assert pegar(tecnico_a, 17, PONTO_B)[0].content == b""  # fora do escopo
    sem = criar_usuario("sem@itree.teste", [])
    x, y = _tile(PONTO_A["longitude"], PONTO_A["latitude"], 17)
    assert cliente.como(sem).get(f"/api/v1/mapa/tiles/edificacoes/17/{x}/{y}").status_code == 403


def test_tile_do_macrozoneamento_traz_a_sigla_em_qualquer_zoom(cliente, revisor, territorios):
    macrozoneamento.importar(geojson_macrozona())
    x, y = _tile(PONTO_A["longitude"], PONTO_A["latitude"], 12)
    r = cliente.como(revisor).get(f"/api/v1/mapa/tiles/macrozoneamento/12/{x}/{y}")
    assert r.status_code == 200 and r.content != b""
    camadas = decodificar(r.content, 12, x, y)
    assert {f["props"]["sigla"] for f in camadas["macrozoneamento"]} >= {"ZOP 1"}


def test_camadas_traz_fonte_e_licenca_dos_imoveis(cliente, revisor, territorios):
    edificacao((PONTO_A["longitude"], PONTO_A["latitude"]), territorios["a"], "residencial")
    macrozoneamento.importar(geojson_macrozona())
    corpo = cliente.como(revisor).get("/api/v1/mapa/camadas").json()["imoveis"]
    assert corpo["edificacoes"]["quantidade"] == 1 and corpo["edificacoes"]["cobertura_uso"] == 1
    assert (
        corpo["macrozoneamento"]["quantidade"] == 2 and "SEUMA" in corpo["macrozoneamento"]["fonte"]
    )
    assert corpo["uso_lote"] is None
