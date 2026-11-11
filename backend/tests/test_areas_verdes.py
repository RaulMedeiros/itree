"""Áreas verdes (praças, parques, unidades de conservação) do Fortaleza em Mapas.

Os arquivos de ``tests/dados`` são trechos do dado real, obtido da API em
2026-11-11 (mapas 99, 86 e 737), sem alteração: mantêm os nomes de campo, os
valores e a geometria, inclusive o Z das unidades de conservação.
"""

import json
from datetime import date, timedelta
from pathlib import Path

import pytest
import responses
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from itree.areas_verdes.management.commands.importar_areas_verdes import (
    area_em_m2,
    nome_legivel,
)
from itree.areas_verdes.models import AreaVerde
from itree.areas_verdes.servico import area_verde_do_ponto, situacao_da_fonte
from itree.areas_verdes.tasks import reimportar_areas_verdes
from itree.contas.models import EscopoUsuario
from itree.inventario.models import Arvore

from .conftest import com_escopo, criar_territorio, criar_usuario, quadrado

pytestmark = pytest.mark.django_db

DADOS = Path(__file__).parent / "dados"
PRACAS = str(DADOS / "fortaleza_em_mapas_99_praca.json")
PARQUES = str(DADOS / "fortaleza_em_mapas_86_parque.json")
UCS = str(DADOS / "fortaleza_em_mapas_737_uc.json")
URL = "/api/v1/areas-verdes"


def importar(arquivo, tipo, **extras):
    call_command("importar_areas_verdes", arquivo=arquivo, tipo=tipo, **extras)


@pytest.fixture
def importadas(db):
    importar(PRACAS, "praca")
    importar(PARQUES, "parque")
    importar(UCS, "unidade_conservacao")


# --- Conversões --------------------------------------------------------------


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        ("57.052,50m²", 57052.5),  # formatos reais do mapa 86
        ("1.347.279,45 m²", 1347279.45),
        ("56.323m²", 56323.0),
        ("398.564,50m", 398564.5),
        (8920.07, 8920.07),
        (17801942.97, 17801942.97),
        ("", None),
        (None, None),
        ("sem informação", None),
    ],
)
def test_area_em_m2(valor, esperado):
    assert area_em_m2(valor) == esperado


@pytest.mark.parametrize(
    ("original", "esperado"),
    [
        ("PARQUE URBANO DA LAGOA DO CATAO", "Parque Urbano da Lagoa do Catao"),
        (
            "PARQUE ARQUITETO OTACALIO TEIXEIRA NETO (BISÃO)",
            "Parque Arquiteto Otacalio Teixeira Neto (Bisão)",
        ),
        ("APA do Rio Maranguapinho", "APA do Rio Maranguapinho"),  # nome misto não muda
        ("  Praça   da  Cioba ", "Praça da Cioba"),
    ],
)
def test_nome_legivel(original, esperado):
    assert nome_legivel(original) == esperado


# --- Importação com o dado real ----------------------------------------------


def test_importa_pracas_do_dado_real():
    importar(PRACAS, "praca")
    largo = AreaVerde.objects.get(tipo="praca", codigo_externo="124")
    assert largo.nome == "Largo do Mercado"
    assert largo.nome_popular == "Praça dos Correios"
    assert largo.orgao_gestor == "UrbFor" and largo.esfera == "Municipal"
    assert largo.area_m2 == pytest.approx(largo.geom.transform(31984, clone=True).area, rel=0.01)
    assert largo.geom.geom_type == "MultiPolygon" and largo.geom.srid == 4326
    x, y = largo.geom.centroid.coords
    assert -38.65 < x < -38.4 and -3.9 < y < -3.68  # dentro de Fortaleza
    assert largo.metadados["bairro"] == "Centro"
    assert largo.metadados["src_original"] == "EPSG: 31984 (SIRGAS 2000 - UTM 24S)"
    assert largo.metadados["ano_referencia"] == 2019


def test_sem_informacao_nao_vira_nome_popular(tmp_path):
    dados = json.loads(Path(PRACAS).read_text())
    dados["features"][1]["properties"]["nome_pop"] = "sem informação"  # valor comum na fonte
    arquivo = tmp_path / "pracas.json"
    arquivo.write_text(json.dumps(dados))
    importar(str(arquivo), "praca")
    assert AreaVerde.objects.get(codigo_externo="366").nome_popular == ""


def test_importa_parques_com_area_em_texto_e_nome_legivel():
    importar(PARQUES, "parque")
    bisao = AreaVerde.objects.get(tipo="parque", codigo_externo="2")
    assert bisao.nome == "Parque Arquiteto Otacalio Teixeira Neto (Bisão)"
    assert bisao.metadados["nome_original"] == "PARQUE ARQUITETO OTACALIO TEIXEIRA NETO (BISÃO)"
    assert bisao.ato_legal == "LEI N 8503, de 26/12/2000"
    assert bisao.area_m2 == 22137.5
    assert bisao.orgao_gestor == "SEUMA" and bisao.esfera == "Municipal"


def test_importa_unidades_de_conservacao_e_descarta_o_z():
    importar(UCS, "unidade_conservacao")
    arie = AreaVerde.objects.get(codigo_externo="17")
    assert arie.nome == "ARIE Prof. Abreu Matos"
    assert arie.esfera == "Municipal" and arie.orgao_gestor == "SEUMA"
    assert arie.ato_legal == "LEI N° 10.463, DE 31 DE MARÇO DE 2016"
    assert arie.area_m2 == 188371.5
    assert arie.metadados["categoria"] == "ARIE"
    assert not arie.geom.hasz  # a fonte traz Z; a coluna é 2D
    # O mesmo nome com códigos diferentes são dois registros (feições do mesmo polígono).
    assert AreaVerde.objects.filter(nome="APA do Estuário do Rio Ceará").count() == 2


def test_proveniencia_completa():
    antes = timezone.now()
    importar(UCS, "unidade_conservacao")
    arie = AreaVerde.objects.get(codigo_externo="17")
    assert arie.fonte.startswith("Fortaleza em Mapas")
    assert arie.fonte_url == "https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=737"
    assert "citação" in arie.licenca
    assert str(arie.data_referencia) == "2023-01-01"
    assert arie.ingerido_em >= antes


def test_data_referencia_pode_ser_informada():
    importar(PRACAS, "praca", data_referencia=date(2024, 2, 21))
    assert {str(a.data_referencia) for a in AreaVerde.objects.all()} == {"2024-02-21"}


def test_reimportar_e_idempotente_e_atualiza(importadas):
    total = AreaVerde.objects.count()
    assert total == 7
    ids = set(AreaVerde.objects.values_list("id", flat=True))
    AreaVerde.objects.filter(codigo_externo="124").update(nome="Nome antigo")
    importar(PRACAS, "praca")
    importar(PARQUES, "parque")
    importar(UCS, "unidade_conservacao")
    assert AreaVerde.objects.count() == total
    assert set(AreaVerde.objects.values_list("id", flat=True)) == ids
    assert AreaVerde.objects.get(codigo_externo="124", tipo="praca").nome == "Largo do Mercado"


def test_mesmo_codigo_em_tipos_diferentes_nao_colide(importadas):
    # Praça 124 e unidade 17 etc.: o código só é único dentro do tipo.
    AreaVerde.objects.filter(tipo="parque", codigo_externo="2").update(codigo_externo="124")
    assert AreaVerde.objects.filter(codigo_externo="124").count() == 2


def test_sem_codigo_usa_o_nome_como_chave(tmp_path):
    dados = json.loads(Path(PRACAS).read_text())
    for f in dados["features"]:
        f["properties"].pop("id")
    arquivo = tmp_path / "sem_codigo.json"
    arquivo.write_text(json.dumps(dados))
    importar(str(arquivo), "praca")
    importar(str(arquivo), "praca")
    assert AreaVerde.objects.filter(codigo_externo="").count() == 2


def test_ignora_feicao_sem_geometria_ou_nome(tmp_path):
    dados = json.loads(Path(PRACAS).read_text())
    dados["features"][0]["geometry"] = None
    dados["features"][1]["properties"]["nome"] = "  "
    arquivo = tmp_path / "incompleto.json"
    arquivo.write_text(json.dumps(dados))
    importar(str(arquivo), "praca")
    assert AreaVerde.objects.count() == 0


def test_poligono_simples_e_srid_projetado_sao_normalizados(tmp_path):
    dados = json.loads(Path(PRACAS).read_text())
    feicao = dados["features"][0]
    feicao["geometry"] = {
        "type": "Polygon",
        "coordinates": [
            [[552000, 9585000], [552100, 9585000], [552100, 9585100], [552000, 9585000]]
        ],
    }
    dados["features"] = [feicao]
    dados["crs"] = {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::31984"}}
    arquivo = tmp_path / "utm.json"
    arquivo.write_text(json.dumps(dados))
    importar(str(arquivo), "praca")
    praca = AreaVerde.objects.get()
    assert praca.geom.geom_type == "MultiPolygon" and praca.geom.srid == 4326
    x, y = praca.geom.centroid.coords
    assert -38.6 < x < -38.4 and -3.8 < y < -3.7


def test_nao_importa_dados_pessoais():
    """O mapa 622 traz o adotante (dado pessoal): nenhum campo assim é lido."""
    campos = {f.name for f in AreaVerde._meta.get_fields()}
    assert not {"adotante", "adotante_nome"} & campos


def test_erros_claros(tmp_path):
    with pytest.raises(CommandError, match="exige --tipo"):
        call_command("importar_areas_verdes", arquivo=PRACAS)
    with pytest.raises(CommandError, match="Não foi possível ler"):
        importar(str(tmp_path / "nao_existe.json"), "praca")
    ruim = tmp_path / "ruim.json"
    ruim.write_text('{"mensagem": "erro"}')
    with pytest.raises(CommandError, match="FeatureCollection"):
        importar(str(ruim), "praca")


@responses.activate
def test_importa_pela_api_com_as_urls_oficiais():
    for mapa, caminho in [(99, PRACAS), (86, PARQUES), (737, UCS)]:
        responses.get(
            f"https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id={mapa}",
            body=Path(caminho).read_text(),
            content_type="application/json",
        )
    call_command("importar_areas_verdes")
    assert AreaVerde.objects.count() == 7
    assert [c.request.url for c in responses.calls] == [
        f"https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id={m}" for m in (99, 86, 737)
    ]


@responses.activate
def test_falha_da_api_nao_deixa_importacao_parcial():
    responses.get(
        "https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=99",
        body=Path(PRACAS).read_text(),
        content_type="application/json",
    )
    responses.get("https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=86", status=503)
    with pytest.raises(CommandError, match="Falha ao obter"):
        call_command("importar_areas_verdes")
    assert AreaVerde.objects.count() == 0


def test_auditoria_resume_geometria(cliente, admin, importadas):
    eventos = (
        cliente.como(admin)
        .get("/api/v1/admin/auditoria", {"entidade": "areas_verdes.AreaVerdeEvent"})
        .json()["results"]
    )
    assert len(eventos) == 7 and all(e["dados"]["geom"] == "(geometria)" for e in eventos)
    assert eventos[0]["contexto"]["evento"] == "importacao_areas_verdes"


# --- API ---------------------------------------------------------------------


def _usuario_com_escopo(*territorios, papeis=("gestor",)):
    return com_escopo(criar_usuario("av@itree.teste", list(papeis)), *territorios)


def _fortaleza():
    return criar_territorio("Fortaleza", tipo="municipio", geom=quadrado(-38.7, -3.95, 0.4))


def _nomes(resposta):
    assert resposta.status_code == 200
    return {f["properties"]["nome"] for f in resposta.json()["features"]}


def test_lista_geojson_com_proveniencia(cliente, importadas):
    usuario = _usuario_com_escopo(_fortaleza())
    resposta = cliente.como(usuario).get(URL)
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["type"] == "FeatureCollection" and len(corpo["features"]) == 7
    feicao = next(f for f in corpo["features"] if f["properties"]["nome"] == "Largo do Mercado")
    assert feicao["geometry"]["type"] == "MultiPolygon"
    p = feicao["properties"]
    assert p["tipo"] == "praca" and p["tipo_rotulo"] == "Praça"
    assert p["fonte"].startswith("Fortaleza em Mapas") and p["licenca"]
    assert p["data_referencia"] == "2019-01-01" and p["ingerido_em"]
    assert "metadados" not in p


def test_filtra_por_tipo(cliente, importadas):
    c = cliente.como(_usuario_com_escopo(_fortaleza()))
    assert len(_nomes(c.get(URL, {"tipo": "praca"}))) == 2  # "Sem Denominação Oficial" + Largo
    assert _nomes(c.get(URL, {"tipo": "parque"})) == {
        "Parque Arquiteto Otacalio Teixeira Neto (Bisão)",
        "Parque das Iguanas",
    }
    assert c.get(URL, {"tipo": "jardim"}).status_code == 400


def test_filtra_por_bbox(cliente, importadas):
    c = cliente.como(_usuario_com_escopo(_fortaleza()))
    largo = AreaVerde.objects.get(codigo_externo="124", tipo="praca")
    oeste, sul, leste, norte = largo.geom.extent
    perto = f"{oeste - 0.0001},{sul - 0.0001},{leste + 0.0001},{norte + 0.0001}"
    assert "Largo do Mercado" in _nomes(c.get(URL, {"bbox": perto, "tipo": "praca"}))
    longe = "-38.40,-3.70,-38.39,-3.69"
    assert _nomes(c.get(URL, {"bbox": longe, "tipo": "praca"})) == set()
    for invalido in ["a,b,c,d", "1,2,3", "10,0,-10,5", "-200,0,0,5"]:
        assert c.get(URL, {"bbox": invalido}).status_code == 400


def test_respeita_o_escopo_territorial(cliente, importadas):
    largo = AreaVerde.objects.get(codigo_externo="124", tipo="praca")
    oeste, sul, leste, norte = largo.geom.extent
    so_o_largo = criar_territorio(
        "Quadra do Largo", geom=quadrado(oeste - 0.0005, sul - 0.0005, 0.001)
    )
    com_escopo_curto = _usuario_com_escopo(so_o_largo)
    c = cliente.como(com_escopo_curto)
    nomes = _nomes(c.get(URL))
    assert "Largo do Mercado" in nomes and "Parque das Iguanas" not in nomes

    area = AreaVerde.objects.get(nome="Parque das Iguanas")
    assert c.get(f"{URL}/{area.id}").status_code == 404
    assert c.get(f"{URL}/{largo.id}").status_code == 200

    sem_escopo = criar_usuario("sem@itree.teste", ["gestor"])
    assert _nomes(cliente.como(sem_escopo).get(URL)) == set()


def test_exige_permissao_de_leitura_do_mapa(cliente, importadas):
    sem_papel = com_escopo(criar_usuario("nada@itree.teste", []), _fortaleza())
    assert cliente.como(sem_papel).get(URL).status_code == 403
    area = AreaVerde.objects.first()
    assert cliente.como(sem_papel).get(f"{URL}/{area.id}").status_code == 403


def test_somente_leitura(cliente, importadas):
    c = cliente.como(_usuario_com_escopo(_fortaleza(), papeis=("administrador",)))
    area = AreaVerde.objects.first()
    assert c.post(URL, {}, format="json").status_code == 405
    assert c.delete(f"{URL}/{area.id}").status_code == 405
    assert c.patch(f"{URL}/{area.id}", {"nome": "x"}, format="json").status_code == 405


def test_detalhe_em_geojson(cliente, importadas):
    c = cliente.como(_usuario_com_escopo(_fortaleza()))
    uc = AreaVerde.objects.get(codigo_externo="17", tipo="unidade_conservacao")
    corpo = c.get(f"{URL}/{uc.id}").json()
    assert corpo["type"] == "Feature" and corpo["id"] == str(uc.id)
    assert corpo["properties"]["ato_legal"].startswith("LEI")
    assert corpo["properties"]["esfera"] == "Municipal"
    assert len(corpo["geometry"]["coordinates"][0][0][0]) == 2  # sem Z


def test_precisao_reduz_o_tamanho(cliente, importadas):
    c = cliente.como(_usuario_com_escopo(_fortaleza()))
    maior = len(c.get(URL, {"precisao": 8}).content)
    menor = len(c.get(URL, {"precisao": 3}).content)
    assert menor < maior


def test_camadas_listam_as_areas_verdes(cliente, importadas):
    corpo = cliente.como(_usuario_com_escopo(_fortaleza())).get("/api/v1/mapa/camadas").json()
    pracas = next(a for a in corpo["areas_verdes"] if a["tipo"] == "praca")
    assert pracas["quantidade"] == 2
    assert pracas["fontes"][0].startswith("Fortaleza em Mapas")
    assert pracas["licencas"] and pracas["data_referencia_mais_antiga"] == "2019-01-01"
    assert pracas["ingerido_em"]


# --- Em área verde (ficha e painel da árvore) -------------------------------


def _ponto_dentro(area):
    return area.geom.point_on_surface


def test_area_verde_do_ponto_prefere_a_mais_especifica(importadas):
    largo = AreaVerde.objects.get(codigo_externo="124", tipo="praca")
    ponto = _ponto_dentro(largo)
    assert area_verde_do_ponto(ponto) == largo
    # Uma unidade de conservação que também cobre o ponto não vence a praça.
    AreaVerde.objects.create(
        tipo="unidade_conservacao",
        nome="APA que cobre tudo",
        geom=quadrado(*largo.geom.extent[:2], 1),
        fonte="Teste",
        ingerido_em=timezone.now(),
    )
    assert area_verde_do_ponto(ponto) == largo
    assert area_verde_do_ponto(None) is None


def test_ficha_da_arvore_informa_a_area_verde(cliente, importadas, revisor):
    largo = AreaVerde.objects.get(codigo_externo="124", tipo="praca")
    dentro = Arvore.objects.create(origem_registro="importacao", geom=_ponto_dentro(largo))
    fora = Arvore.objects.create(
        origem_registro="importacao", geom=quadrado(-38.30, -3.60, 0.001).point_on_surface
    )
    sem_geom = Arvore.objects.create(origem_registro="importacao")
    EscopoUsuario.objects.filter(usuario=revisor).delete()
    com_escopo(
        revisor,
        _fortaleza(),
        criar_territorio("Mundo", tipo="municipio", geom=quadrado(-39, -4, 1)),
    )
    c = cliente.como(revisor)
    ficha = c.get(f"/api/v1/arvores/{dentro.id}").json()
    assert ficha["em_area_verde"] == {
        "id": str(largo.id),
        "nome": "Largo do Mercado",
        "tipo": "praca",
    }
    assert c.get(f"/api/v1/arvores/{fora.id}").json()["em_area_verde"] is None
    assert c.get(f"/api/v1/arvores/{sem_geom.id}").json()["em_area_verde"] is None


# --- Reimportação mensal e fonte desatualizada (RF-INT-005) ---------------------


def _antes(dias):
    AreaVerde.objects.update(ingerido_em=timezone.now() - timedelta(days=dias))


def test_fonte_recente_nao_e_marcada_como_desatualizada(cliente, importadas):
    _antes(60)  # no limite: ainda vale
    situacao = cliente.como(_usuario_com_escopo(_fortaleza())).get(URL).json()["situacao_da_fonte"]
    assert (situacao["dias"], situacao["limite_dias"], situacao["desatualizada"]) == (60, 60, False)


def test_fonte_com_mais_de_60_dias_e_marcada_como_desatualizada(cliente, importadas):
    _antes(61)
    situacao = cliente.como(_usuario_com_escopo(_fortaleza())).get(URL).json()["situacao_da_fonte"]
    assert situacao["desatualizada"] is True and situacao["dias"] == 61
    assert situacao["ultima_importacao"]


def test_sem_areas_importadas_nao_ha_aviso(cliente, db):
    situacao = cliente.como(_usuario_com_escopo(_fortaleza())).get(URL).json()["situacao_da_fonte"]
    assert situacao["ultima_importacao"] is None and situacao["desatualizada"] is False


def test_limite_do_aviso_vem_da_configuracao(cliente, importadas, settings):
    settings.AREAS_VERDES_IDADE_MAXIMA_DIAS = 10
    _antes(11)
    situacao = cliente.como(_usuario_com_escopo(_fortaleza())).get(URL).json()["situacao_da_fonte"]
    assert situacao["desatualizada"] is True and situacao["limite_dias"] == 10


def test_tarefa_mensal_esta_agendada():
    from config.settings import CELERY_BEAT_SCHEDULE

    agenda = CELERY_BEAT_SCHEDULE["reimportar-areas-verdes"]
    assert agenda["task"] == "itree.areas_verdes.tasks.reimportar_areas_verdes"
    assert agenda["schedule"].day_of_month == {2}


@responses.activate
def test_tarefa_reimporta_pela_api_e_renova_a_data(importadas):
    _antes(90)
    for mapa, caminho in [(99, PRACAS), (86, PARQUES), (737, UCS)]:
        responses.get(
            f"https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id={mapa}",
            body=Path(caminho).read_text(),
            content_type="application/json",
        )
    reimportar_areas_verdes()
    assert AreaVerde.objects.count() == 7
    assert situacao_da_fonte()["desatualizada"] is False


@responses.activate
def test_tarefa_com_falha_da_api_mantem_a_data_antiga_e_o_aviso(importadas):
    _antes(90)
    responses.get("https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=99", status=503)
    with pytest.raises(CommandError):
        reimportar_areas_verdes()
    assert situacao_da_fonte()["desatualizada"] is True
