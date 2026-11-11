"""Arborização do entorno por bairro (Censo 2022, IBGE): leitura do formato real,
importação idempotente, agregação por escopo, painel e análise.

``dados/censo2022_faces_entorno_trecho.csv`` é um trecho literal do arquivo real
``Agregados_por_bairros_entorno_faces_BR.csv`` (ISO-8859-1, separado por ``;``):
o cabeçalho completo, quatro bairros de Fortaleza e um de outro município."""

import io
import zipfile
from datetime import date
from pathlib import Path

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from itree.indicadores import externos
from itree.indicadores.models import IndicadorTerritorialExterno

from .conftest import com_escopo, criar_territorio, criar_usuario, quadrado

pytestmark = pytest.mark.django_db

TRECHO = Path(__file__).parent / "dados" / "censo2022_faces_entorno_trecho.csv"
# (faces com 1 ou mais árvores, total de faces), conferido contra o CSV real.
ESPERADO = {
    "2304400001": (390, 495),  # São Gerardo
    "2304400002": (938, 1449),  # Aldeota
    "2304400003": (308, 633),  # Álvaro Weyne
    "2304400004": (266, 459),  # Amadeu Furtado
}
URL_PAINEL = "/api/v1/indicadores/painel"


def _zip(conteudo: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Agregados_por_bairros_entorno_faces_BR.csv", conteudo)
    return buf.getvalue()


@pytest.fixture
def bairros_ibge(db):
    """Dois bairros A e B (com códigos IBGE reais) e um terceiro, sem código do Censo."""
    return {
        "aldeota": criar_territorio("Aldeota", codigo="2304400002", geom=quadrado(-38.56, -3.76)),
        "sao_gerardo": criar_territorio(
            "São Gerardo", codigo="2304400001", geom=quadrado(-38.54, -3.76)
        ),
        "sem_codigo": criar_territorio("Sem código", codigo="x", geom=quadrado(-38.52, -3.76)),
    }


def test_ler_csv_real():
    leitura = externos.ler_csv(TRECHO.read_bytes())
    assert leitura.por_bairro["2304400002"] == (938, 1449)
    assert leitura.por_bairro["1100015001"] == (126, 180)  # bairro de outro município
    assert leitura.inconsistentes == 0 and leitura.linhas == 5
    assert {k: v for k, v in leitura.por_bairro.items() if k.startswith("2304400")} == ESPERADO


def test_ler_zip_e_filtro_por_codigos():
    leitura = externos.ler_csv(_zip(TRECHO.read_bytes()), {"2304400002"})
    assert leitura.por_bairro == {"2304400002": (938, 1449)}


def test_ler_descarta_linha_que_nao_fecha_com_o_total():
    linhas = TRECHO.read_bytes().split(b"\n")
    # Aldeota com V05400 alterado: a soma das faixas deixa de fechar.
    aldeota = next(linha for linha in linhas if linha.startswith(b'"2304400002"'))
    quebrada = aldeota.replace(b'"1449"', b'"1500"', 1)
    leitura = externos.ler_csv(b"\n".join([linhas[0], quebrada]) + b"\n")
    assert leitura.por_bairro == {} and leitura.inconsistentes == 1


def test_ler_csv_sem_colunas_do_censo():
    with pytest.raises(externos.CensoInvalido):
        externos.ler_csv(b'"CD_BAIRRO";"V05400"\n"1";"2"\n')


def test_comando_importa_com_proveniencia_e_e_idempotente(bairros_ibge, tmp_path, capsys):
    arquivo = tmp_path / "censo.zip"
    arquivo.write_bytes(_zip(TRECHO.read_bytes()))
    for _ in range(2):
        call_command("importar_censo_arborizacao", arquivo=str(arquivo))
    assert IndicadorTerritorialExterno.objects.count() == 2
    aldeota = IndicadorTerritorialExterno.objects.get(territorio=bairros_ibge["aldeota"])
    assert (aldeota.numerador, aldeota.denominador, float(aldeota.valor)) == (938, 1449, 64.73)
    assert aldeota.unidade == "%"
    assert aldeota.fonte == "IBGE, Censo Demográfico 2022"
    assert aldeota.fonte_url == externos.URL_CENSO_FACES
    assert aldeota.data_referencia == date(2022, 7, 31) and aldeota.ingerido_em
    assert "V05431" in aldeota.metodo and "faces de quadra" in aldeota.definicao
    assert aldeota.licenca
    assert "Sem código" in capsys.readouterr().out


def test_comando_falha_com_arquivo_invalido(tmp_path):
    ruim = tmp_path / "x.csv"
    ruim.write_bytes(b"a;b\n1;2\n")
    with pytest.raises(CommandError, match="Colunas ausentes"):
        call_command("importar_censo_arborizacao", arquivo=str(ruim))
    with pytest.raises(CommandError, match="Não foi possível obter"):
        call_command("importar_censo_arborizacao", arquivo=str(tmp_path / "nao-existe.zip"))


def _importar():
    externos.importar(TRECHO.read_bytes())


def test_escopo_soma_numeradores_e_denominadores(cliente, bairros_ibge):
    municipio = criar_territorio("Fortaleza", tipo="municipio", geom=quadrado(-38.6, -3.8, 0.2))
    _importar()
    gestor = com_escopo(criar_usuario("g@itree.teste", ["gestor"]), municipio)
    [item] = externos.contexto_externo(gestor)
    # Soma de numeradores e denominadores (938 + 390) / (1449 + 495), não a média de %.
    assert (item["numerador"], item["base"]) == (1328, 1944)
    assert item["valor"] == 68.31
    assert item["bairros_com_dado"] == 2 and item["bairros_no_escopo"] == 3
    assert item["fonte"] == "IBGE, Censo Demográfico 2022"
    assert item["data_referencia"] == date(2022, 7, 31)


def test_escopo_de_um_bairro_so_ve_o_proprio(bairros_ibge):
    _importar()
    usuario = com_escopo(criar_usuario("t@itree.teste", ["tecnico"]), bairros_ibge["aldeota"])
    [item] = externos.contexto_externo(usuario)
    assert (item["numerador"], item["base"], item["bairros_no_escopo"]) == (938, 1449, 1)
    # Sem escopo: nada, e nunca zero.
    assert externos.contexto_externo(criar_usuario("s@itree.teste", ["tecnico"])) == []


def test_painel_traz_contexto_externo_separado(cliente, bairros_ibge):
    municipio = criar_territorio("Fortaleza", tipo="municipio", geom=quadrado(-38.6, -3.8, 0.2))
    gestor = com_escopo(criar_usuario("g@itree.teste", ["gestor"]), municipio)
    assert cliente.como(gestor).get(URL_PAINEL).json()["contexto_externo"] == []
    _importar()
    corpo = cliente.get(URL_PAINEL).json()
    [item] = corpo["contexto_externo"]
    assert item["id"] == externos.ARBORIZACAO_FACES and item["valor"] == 68.31
    assert item["definicao"] and item["metodo"] and item["ingerido_em"] and item["fonte_url"]
    assert externos.ARBORIZACAO_FACES not in {i["id"] for i in corpo["indicadores"]}
    # Filtro de bairro restringe o valor ao bairro escolhido.
    um = cliente.get(URL_PAINEL, {"bairro": str(bairros_ibge["aldeota"].pk)}).json()
    assert (um["contexto_externo"][0]["numerador"], um["contexto_externo"][0]["base"]) == (
        938,
        1449,
    )


def test_analise_arborizacao_por_bairro(cliente, bairros_ibge):
    _importar()
    gestor = com_escopo(
        criar_usuario("g@itree.teste", ["gestor"]),
        criar_territorio("Fortaleza", tipo="municipio", geom=quadrado(-38.6, -3.8, 0.2)),
    )
    corpo = (
        cliente.como(gestor)
        .get("/api/v1/relatorios/analise", {"analise": "arborizacao_entorno_por_bairro"})
        .json()
    )
    assert [(linha["rotulo"], linha["valor"], linha["base"]) for linha in corpo["linhas"]] == [
        ("São Gerardo", 78.79, 495),
        ("Aldeota", 64.73, 1449),
    ]
    assert corpo["unidade"] == "%" and "IBGE" in corpo["fonte"] and corpo["por_bairro"]
    catalogo = cliente.get("/api/v1/relatorios/catalogo").json()["analises"]
    assert "arborizacao_entorno_por_bairro" in {a["id"] for a in catalogo}


URL_CAMADA = "/api/v1/indicadores/externos/arborizacao-entorno"


def test_camada_geojson_pinta_bairros_com_dado_e_marca_os_sem_dado(cliente, bairros_ibge):
    _importar()
    gestor = com_escopo(
        criar_usuario("g@itree.teste", ["gestor"]),
        criar_territorio("Fortaleza", tipo="municipio", geom=quadrado(-38.6, -3.8, 0.2)),
    )
    resposta = cliente.como(gestor).get(URL_CAMADA)
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["type"] == "FeatureCollection"
    por_nome = {f["properties"]["nome"]: f for f in corpo["features"]}
    # A geometria é a do bairro, com o mesmo id de territorios/geojson.
    aldeota = por_nome["Aldeota"]
    assert aldeota["id"] == str(bairros_ibge["aldeota"].pk)
    assert aldeota["geometry"]["type"] == "MultiPolygon"
    assert aldeota["properties"] == {
        "nome": "Aldeota",
        "valor": 64.73,
        "faces_com_arvore": 938,
        "faces": 1449,
    }
    # Sem dado do Censo: valor nulo (nunca zero), e o bairro continua na camada.
    assert por_nome["Sem código"]["properties"]["valor"] is None
    assert por_nome["Sem código"]["properties"]["faces"] is None
    # A proveniência vem uma vez, no topo, e não em cada feição.
    proveniencia = corpo["proveniencia"]
    assert proveniencia["fonte"] == "IBGE, Censo Demográfico 2022"
    assert proveniencia["data_referencia"] == "2022-07-31"
    assert proveniencia["definicao"] and proveniencia["metodo"] and proveniencia["fonte_url"]
    assert "fonte" not in aldeota["properties"]


def test_camada_geojson_respeita_o_escopo_e_a_permissao(cliente, bairros_ibge):
    _importar()
    tecnico = com_escopo(criar_usuario("t@itree.teste", ["tecnico"]), bairros_ibge["aldeota"])
    corpo = cliente.como(tecnico).get(URL_CAMADA).json()
    assert [f["properties"]["nome"] for f in corpo["features"]] == ["Aldeota"]
    # Sem escopo: nenhuma feição e nenhuma proveniência.
    vazio = cliente.como(criar_usuario("s@itree.teste", ["tecnico"])).get(URL_CAMADA).json()
    assert vazio["features"] == [] and vazio["proveniencia"] is None
    # Sem a permissão de leitura do mapa, 403.
    sem_mapa = criar_usuario("n@itree.teste", [])
    assert cliente.como(sem_mapa).get(URL_CAMADA).status_code == 403


def test_camada_geojson_sem_importacao_nao_tem_proveniencia(cliente, bairros_ibge, gestor):
    corpo = cliente.como(gestor).get(URL_CAMADA, {"precisao": 3}).json()
    assert corpo["proveniencia"] is None
    assert all(f["properties"]["valor"] is None for f in corpo["features"])
