"""Adoção de praças e áreas verdes (Fortaleza em Mapas, mapa 622): importação sem dado pessoal,
vínculo com a praça mais próxima a até 50 m, ficha da área verde e filtro da camada.

Os registros de teste são sintéticos e têm a estrutura real do mapa 622 (campos ``id``, ``fid``,
``Nome``, ``Adotante``, ``Regional``, ``x``, ``y``, ``Fonte``, ``ano_ref``, ``epsg_codif``, ponto
com Z, CRS 4326). Os adotantes são inventados e carregam um termo-sentinela para os testes de que
nenhum nome chega ao banco, à API, à saída do comando nem ao log. Nenhum teste usa rede.
"""

import io
import json
import logging

import pytest
import responses
from django.core.management import call_command
from django.core.management.base import CommandError
from django.forms.models import model_to_dict
from django.utils import timezone

from itree.areas_verdes import adocao
from itree.areas_verdes.models import AdocaoPraca, AreaVerde, MotivoSemVinculo
from itree.areas_verdes.tasks import reimportar_adocao_pracas

from .conftest import com_escopo, criar_territorio, criar_usuario, quadrado

pytestmark = pytest.mark.django_db

URL = "/api/v1/areas-verdes"
URL_FONTE = "https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=622"
SENTINELA = "ZEFERINO SENTINELA"
LON, LAT, LADO = -38.5, -3.75, 0.001  # praça A: um quadrado de cerca de 110 m
UM_METRO = 1 / 110_900  # graus de longitude por metro, nesta latitude (cos 3,75°)
UM_METRO_LAT = 1 / 110_600  # graus de latitude por metro


def feicao(id_, nome, adotante, lon, lat, **extras):
    props = {
        "id": id_,
        "fid": id_,
        "Nome": nome,
        "Adotante": adotante,
        "Regional": "REGIONAL II",
        "x": "546928.845025135",
        "y": "9588111.02394335",
        "Fonte": "SEUMA",
        "ano_ref": "2023",
        "epsg_codif": "EPSG: 31984 (SIRGAS 2000 - UTM 24S); Codificação: UTF-8",
        **extras,
    }
    return {
        "type": "Feature",
        "id": f"vw_AdocaoPracasEAreasVerdes.fid-{id_}",
        "geometry": {"type": "Point", "coordinates": [lon, lat, 0]},
        "geometry_name": "The_geom",
        "properties": props,
    }


def colecao(*feicoes):
    return {
        "type": "FeatureCollection",
        "features": list(feicoes),
        "totalFeatures": len(feicoes),
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::4326"}},
    }


def praca(nome, lon, lat, codigo, tipo="praca", lado=LADO):
    return AreaVerde.objects.create(
        tipo=tipo,
        nome=nome,
        codigo_externo=codigo,
        geom=quadrado(lon, lat, lado),
        fonte="Teste",
        ingerido_em=timezone.now(),
    )


@pytest.fixture
def pracas(db):
    """A (em LON, LAT), B 60 m a leste de A, um parque junto de A e uma praça longe."""
    a = praca("Praça A", LON, LAT, "1")
    b = praca("Praça B", LON + LADO + 60 * UM_METRO, LAT, "2")
    parque = praca("Parque Vizinho", LON, LAT + LADO + 10 * UM_METRO, "3", tipo="parque")
    longe = praca("Praça Longe", -38.4, -3.85, "4")
    return {"a": a, "b": b, "parque": parque, "longe": longe}


def pontos():
    leste_de_a = LON + LADO
    return colecao(
        # Dentro de A: distância 0.
        feicao(1, "PRAÇA A", f"{SENTINELA} DA SILVA", LON + LADO / 2, LAT + LADO / 2),
        # 30 m a leste de A e 30 m a oeste de B: a mais próxima é A ou B; o ponto fica a 20 m de B.
        feicao(2, "PRAÇA B", f"EMPRESA {SENTINELA} LTDA", leste_de_a + 40 * UM_METRO, LAT + 0.0005),
        # A 80 m de qualquer praça: sem vínculo (o raio é de 50 m).
        feicao(3, "CANTEIRO CENTRAL NA AV. X", f"ASSOCIAÇÃO {SENTINELA}", LON, LAT - 80 * UM_METRO_LAT),
        # Dentro do parque, a 85 m de qualquer praça: o vínculo é só com praça.
        feicao(4, "ÁREA VERDE", f"CONDOMÍNIO {SENTINELA}", LON + LADO / 2, LAT + LADO + 85 * UM_METRO_LAT),
    )  # fmt: skip


def importar(dados=None, **extras):
    return adocao.importar(
        dados or pontos(), fonte_url=URL_FONTE, licenca="Termos da API", **extras
    )


# --- Categoria do adotante ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("texto", "tipo"),
    [
        ("SANGATI BERGA S.A", "empresa"),
        ("ORGANIZAÇÃO EDUCACIONAL FARIAS BRITO LTDA", "empresa"),
        ("CEARÁ SHOW ESPETÁCULOS LTDA - ME", "empresa"),
        ("ANDRE NESTOR DO NASCIMENTO - ME", "empresa"),
        ("CONSTRUTORA MARQUISE", "empresa"),
        ("ASSOCIAÇÃO CIDADE 2000", "associacao"),
        ("CONDOMINIO EDIFICIO LIDO", "associacao"),
        ("VIA SUL CONDOMÍNIO", "associacao"),
        # Pessoas, nomes de fantasia e vazio: nunca se afirma o que não está claro.
        ("ANTONIEL ALVES BEZERRA", "nao_classificado"),
        ("JOSÉ ME DA SILVA SA", "nao_classificado"),
        ("MARIA SA SILVA", "nao_classificado"),
        ("TARANTULAS GRILL", "nao_classificado"),
        ("", "nao_classificado"),
        (None, "nao_classificado"),
    ],
)
def test_categoria_do_adotante_so_quando_a_razao_social_deixa_claro(texto, tipo):
    assert adocao.tipo_do_adotante(texto) == tipo


# --- Leitura -----------------------------------------------------------------------------------


def test_leitura_nao_tem_onde_guardar_o_adotante():
    leitura = adocao.ler_adocoes(pontos())
    assert len(leitura.adocoes) == 4
    for a in leitura.adocoes:
        assert SENTINELA not in json.dumps(a.__dict__, default=str)
    campos = {f.name for f in AdocaoPraca._meta.get_fields()}
    assert not campos & {"adotante", "nome_adotante", "contato", "telefone", "email", "cpf", "cnpj"}


def test_leitura_ignora_o_que_nao_e_ponto_sem_id_sem_nome_ou_repetido():
    ruim = colecao(
        feicao(1, "Praça A", "X", LON, LAT),
        feicao(1, "Praça A de novo", "X", LON, LAT),  # id repetido
        feicao(2, "", "X", LON, LAT),  # sem nome
        feicao(None, "Sem id", "X", LON, LAT),
        {**feicao(4, "Polígono", "X", LON, LAT), "geometry": {"type": "Polygon", "coordinates": []}},
        {**feicao(5, "Sem geometria", "X", LON, LAT), "geometry": None},
        feicao(6, "Fora do globo", "X", 500, LAT),
        "lixo",
    )  # fmt: skip
    leitura = adocao.ler_adocoes(ruim)
    assert [a.codigo_externo for a in leitura.adocoes] == ["1"] and leitura.ignoradas == 7


def test_leitura_recusa_o_que_nao_e_feature_collection():
    with pytest.raises(adocao.AdocaoInvalida, match="FeatureCollection"):
        adocao.ler_adocoes({"mensagem": "erro"})


# --- Importação e vínculo ----------------------------------------------------------------------


def test_liga_cada_ponto_a_praca_mais_proxima_ate_50_m_ou_deixa_sem_vinculo(pracas):
    r = importar()
    assert (r.criadas, r.ligadas, r.sem_vinculo) == (4, 2, 2)
    por_codigo = {a.codigo_externo: a for a in AdocaoPraca.objects.all()}
    assert por_codigo["1"].area_verde == pracas["a"] and por_codigo["1"].distancia_m == 0
    assert por_codigo["2"].area_verde == pracas["b"]
    assert 15 <= por_codigo["2"].distancia_m <= 25
    assert por_codigo["3"].area_verde is None
    assert por_codigo["3"].motivo_sem_vinculo == MotivoSemVinculo.NENHUMA_PRACA_PROXIMA
    # Só praça conta: o ponto 4 está dentro do parque e continua sem vínculo.
    assert por_codigo["4"].area_verde is None and por_codigo["4"].distancia_m is None
    assert r.pracas_adotadas == 2


def test_raio_do_vinculo_e_de_50_metros(pracas):
    meio = LAT + LADO / 2
    importar(
        colecao(
            feicao(1, "P", "X", LON - 45 * UM_METRO, meio),  # a 45 m do contorno de A
            feicao(2, "P", "X", LON - 55 * UM_METRO, meio),  # a 55 m do contorno de A
        )
    )
    assert AdocaoPraca.objects.get(codigo_externo="1").area_verde == pracas["a"]
    assert AdocaoPraca.objects.get(codigo_externo="2").area_verde is None


def test_grava_so_o_permitido_com_a_proveniencia(pracas):
    importar()
    a = AdocaoPraca.objects.get(codigo_externo="1")
    assert (a.nome, a.regional, a.tipo_adotante, a.ano_referencia) == (
        "PRAÇA A",
        "REGIONAL II",
        "nao_classificado",
        2023,
    )
    assert a.geom.srid == 4326 and not a.geom.hasz
    assert (a.fonte, a.fonte_url, a.licenca) == (adocao.FONTE, URL_FONTE, "Termos da API")
    assert a.data_referencia.year == 2023 and a.ingerido_em
    assert AdocaoPraca.objects.get(codigo_externo="2").tipo_adotante == "empresa"
    assert AdocaoPraca.objects.get(codigo_externo="3").tipo_adotante == "associacao"


def test_nenhum_dado_pessoal_chega_ao_banco(pracas):
    importar()
    tudo = json.dumps([model_to_dict(a) for a in AdocaoPraca.objects.all()], default=str)
    tudo += json.dumps([model_to_dict(a) for a in AreaVerde.objects.all()], default=str)
    assert SENTINELA not in tudo and "ZEFERINO" not in tudo
    assert not AdocaoPraca.objects.filter(nome__icontains="SENTINELA").exists()


def test_reimportar_atualiza_sem_duplicar_e_remove_o_que_saiu_da_fonte(pracas):
    importar()
    r = importar(colecao(feicao(1, "PRAÇA A (NOVO NOME)", "OUTRO", LON + LADO / 2, LAT + LADO / 2)))
    assert (r.criadas, r.atualizadas, r.removidas) == (0, 1, 3)
    assert AdocaoPraca.objects.count() == 1
    assert AdocaoPraca.objects.get().nome == "PRAÇA A (NOVO NOME)"


def test_fonte_vazia_nao_apaga_as_adocoes_ja_importadas(pracas):
    importar()
    with pytest.raises(adocao.AdocaoInvalida, match="nenhuma adoção"):
        importar(colecao())
    assert AdocaoPraca.objects.count() == 4


def test_srid_diferente_de_4326_nao_e_aceito_sem_conversao_conferida(pracas):
    with pytest.raises(adocao.AdocaoInvalida):
        importar(pontos(), srid=31984)
    assert not AdocaoPraca.objects.exists()


# --- Comando e tarefa --------------------------------------------------------------------------


def test_comando_relata_sem_mostrar_nenhum_adotante(pracas, tmp_path, caplog):
    arquivo = tmp_path / "adocao.geojson"
    arquivo.write_text(json.dumps(pontos()))
    saida = io.StringIO()
    with caplog.at_level(logging.DEBUG):
        call_command("importar_adocao_pracas", "--arquivo", str(arquivo), stdout=saida)
    texto = saida.getvalue()
    assert "4 na fonte, 4 criada(s)" in texto
    assert "Ligadas a uma praça a até 50 m: 2 (2 praça(s) adotada(s)); sem vínculo: 2" in texto
    assert "Empresa 1" in texto and "Associação ou condomínio 2" in texto
    assert SENTINELA not in texto and SENTINELA not in caplog.text


@responses.activate
def test_comando_baixa_o_mapa_622_pela_api(pracas):
    responses.get(URL_FONTE, body=json.dumps(pontos()), content_type="application/json")
    call_command("importar_adocao_pracas", stdout=io.StringIO())
    assert [c.request.url for c in responses.calls] == [URL_FONTE]
    assert AdocaoPraca.objects.count() == 4


@responses.activate
def test_falha_da_api_nao_altera_nada(pracas):
    importar()
    responses.get(URL_FONTE, status=503)
    with pytest.raises(CommandError, match="Falha ao obter"):
        call_command("importar_adocao_pracas")
    assert AdocaoPraca.objects.count() == 4


def test_comando_com_arquivo_invalido_da_erro_claro(tmp_path):
    ruim = tmp_path / "ruim.json"
    ruim.write_text('{"features": []}')
    with pytest.raises(CommandError, match="nenhuma adoção"):
        call_command("importar_adocao_pracas", "--arquivo", str(ruim))


@responses.activate
def test_tarefa_mensal_reimporta_e_esta_agendada(pracas, settings):
    responses.get(URL_FONTE, body=json.dumps(pontos()), content_type="application/json")
    reimportar_adocao_pracas()
    assert AdocaoPraca.objects.count() == 4
    agenda = settings.CELERY_BEAT_SCHEDULE["reimportar-adocao-pracas"]
    assert agenda["task"] == "itree.areas_verdes.tasks.reimportar_adocao_pracas"
    assert str(agenda["schedule"]._orig_day_of_month) == "2"
    # Depois da reimportação das áreas verdes (04:00 do dia 2), para o vínculo usar as praças novas.
    assert settings.CELERY_BEAT_SCHEDULE["reimportar-areas-verdes"]["schedule"]._orig_hour == 4


@responses.activate
def test_falha_na_tarefa_mensal_sobe_para_o_celery(pracas):
    responses.get(URL_FONTE, status=503)
    with pytest.raises(CommandError):
        reimportar_adocao_pracas()


# --- API: ficha da área verde e filtro da camada -----------------------------------------------


def _usuario():
    municipio = criar_territorio("Fortaleza", tipo="municipio", geom=quadrado(-38.7, -3.95, 0.4))
    return com_escopo(criar_usuario("av@itree.teste", ["gestor"]), municipio)


def _propriedades(corpo):
    return {f["properties"]["nome"]: f["properties"] for f in corpo["features"]}


def test_ficha_da_area_verde_diz_que_esta_adotada_sem_nenhum_dado_pessoal(cliente, pracas):
    importar()
    resposta = cliente.como(_usuario()).get(URL)
    assert resposta.status_code == 200
    por_nome = _propriedades(resposta.json())
    assert por_nome["Praça A"]["adotada"] is True and por_nome["Praça A"]["adocoes"] == 1
    assert por_nome["Praça B"]["adocao_tipos"] == ["Empresa"]
    assert por_nome["Praça A"]["adocao_tipos"] == []  # "não classificado" não aparece
    assert por_nome["Praça A"]["adocao_ano_referencia"] == 2023
    assert por_nome["Praça Longe"]["adotada"] is False and por_nome["Praça Longe"]["adocoes"] == 0
    assert por_nome["Parque Vizinho"]["adotada"] is False
    assert (
        SENTINELA not in resposta.content.decode() and "ZEFERINO" not in resposta.content.decode()
    )
    # Detalhe de uma área
    detalhe = cliente.get(f"{URL}/{pracas['b'].id}").json()["properties"]
    assert detalhe["adotada"] is True and detalhe["adocoes"] == 1


def test_praca_com_duas_adocoes_conta_as_duas(cliente, pracas):
    dados = colecao(
        feicao(1, "PRAÇA A", "UM", LON + LADO / 2, LAT + LADO / 2),
        feicao(2, "PRAÇA A LADO", "DOIS LTDA", LON + LADO / 3, LAT + LADO / 3),
    )
    importar(dados)
    p = _propriedades(cliente.como(_usuario()).get(URL).json())["Praça A"]
    assert p["adocoes"] == 2 and p["adocao_tipos"] == ["Empresa"]


def test_filtro_adotada_devolve_so_as_pracas_com_adocao(cliente, pracas):
    importar()
    c = cliente.como(_usuario())
    assert set(_propriedades(c.get(URL, {"adotada": "1"}).json())) == {"Praça A", "Praça B"}
    assert len(c.get(URL).json()["features"]) == 4


def test_adocao_respeita_o_escopo_e_a_permissao_da_camada(cliente, pracas):
    importar()
    sem_escopo = criar_usuario("sem@itree.teste", ["gestor"])
    assert cliente.como(sem_escopo).get(URL, {"adotada": "1"}).json()["features"] == []
    sem_papel = criar_usuario("nada@itree.teste", [])
    assert cliente.como(sem_papel).get(URL, {"adotada": "1"}).status_code == 403


def test_a_api_nao_expoe_o_que_a_fonte_tem_de_pessoal(cliente, pracas):
    importar()
    corpo = cliente.como(_usuario()).get(URL, {"adotada": "1"}).json()
    for f in corpo["features"]:
        assert not {"adotante", "Adotante", "contato"} & set(f["properties"])
    assert "x" not in corpo["features"][0]["properties"]
