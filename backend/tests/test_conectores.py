"""Conectores de fontes externas (RF-INT-006): segurança da busca, tipos, sincronização,
agendamento e API. Nenhum teste usa a rede: as respostas são simuladas."""

import json
from datetime import timedelta

import pytest
import requests
import responses
from django.utils import timezone

from itree.conectores import clientes, seguranca, servico, tasks
from itree.conectores.models import (
    Conector,
    ConectorEvent,
    ExecucaoConector,
    FeicaoReferencia,
)
from itree.conectores.seguranca import ErroConector
from itree.inventario.models import Arvore, EstadoLote, LoteImportacao, ModeloImportacao
from itree.notificacoes.models import Notificacao

pytestmark = pytest.mark.django_db

HOST = "mapas.fortaleza.ce.gov.br"
URL_GEOJSON = f"https://{HOST}/api/v1/geojson?id=534"
URL = "/api/v1/conectores"


@pytest.fixture(autouse=True)
def _rede_controlada(monkeypatch, settings):
    """DNS público por padrão e sem proxy: cada teste altera o que precisa."""
    monkeypatch.setattr(seguranca, "_resolver", lambda host: ["200.17.1.1"])
    monkeypatch.setattr(seguranca, "_por_proxy", lambda url: False)
    settings.ITREE_CONECTORES_HOSTS_PERMITIDOS = [HOST, "dados.fortaleza.ce.gov.br"]


def ponto(x, y, z=None, **propriedades):
    coordenadas = [x, y] if z is None else [x, y, z]
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": coordenadas},
        "properties": propriedades,
    }


def colecao(*feicoes) -> dict:
    return {"type": "FeatureCollection", "features": list(feicoes)}


def servir(url=URL_GEOJSON, corpo=None, **extras):
    responses.get(url, json=corpo if corpo is not None else colecao(), **extras)


def criar_conector(**extras) -> Conector:
    dados = {
        "nome": "Atendimentos",
        "tipo": "geojson_url",
        "url": URL_GEOJSON,
        "parametros": {"campo_id": "id"},
        "destino": "camada_referencia",
        "orgao": "Prefeitura de Fortaleza",
        "licenca": "Não declarada pela fonte",
        "url_origem": f"https://{HOST}/",
        "ativo": True,
    }
    return Conector.objects.create(**{**dados, **extras})


# --------------------------------------------------------------------------------------------
# Segurança da busca
# --------------------------------------------------------------------------------------------


def test_padrao_da_lista_de_hosts_e_so_o_municipio():
    from django.conf import settings

    import config.settings as s

    assert s.ITREE_CONECTORES_HOSTS_PERMITIDOS == [
        "mapas.fortaleza.ce.gov.br",
        "dados.fortaleza.ce.gov.br",
    ]
    assert settings.ITREE_CONECTORES_MAX_BYTES > 0


@responses.activate
def test_busca_devolve_o_corpo_de_um_host_permitido():
    servir(corpo=colecao(ponto(-38.5, -3.8)))
    assert json.loads(seguranca.buscar(URL_GEOJSON))["type"] == "FeatureCollection"


@responses.activate
def test_host_fora_da_lista_nao_e_buscado():
    with pytest.raises(ErroConector, match="lista de fontes permitidas"):
        seguranca.buscar("https://exemplo.com/dados.geojson")
    assert len(responses.calls) == 0


@responses.activate
def test_so_https(settings):
    with pytest.raises(ErroConector, match="HTTPS"):
        seguranca.buscar(f"http://{HOST}/api/v1/geojson?id=534")
    assert len(responses.calls) == 0


@pytest.mark.parametrize(
    "url",
    [
        f"https://usuario:senha@{HOST}/x",
        f"https://{HOST}:8443/x",
        "https:///sem-host",
    ],
)
@responses.activate
def test_endereco_com_credencial_porta_ou_host_vazio_e_recusado(url):
    with pytest.raises(ErroConector):
        seguranca.buscar(url)
    assert len(responses.calls) == 0


@pytest.mark.parametrize(
    "ip",
    ["10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.1.10", "172.16.0.1", "::1", "fe80::1"]
    + ["::ffff:10.0.0.5", "0.0.0.0", "224.0.0.1", "100.64.0.1"],  # noqa: S104
)
@responses.activate
def test_ip_nao_publico_apos_resolver_o_dns_e_recusado(monkeypatch, ip):
    monkeypatch.setattr(seguranca, "_resolver", lambda host: [ip])
    with pytest.raises(ErroConector, match="não público"):
        seguranca.buscar(URL_GEOJSON)
    assert len(responses.calls) == 0


@responses.activate
def test_basta_um_ip_privado_entre_os_resolvidos(monkeypatch):
    monkeypatch.setattr(seguranca, "_resolver", lambda host: ["200.17.1.1", "10.0.0.5"])
    with pytest.raises(ErroConector, match="não público"):
        seguranca.buscar(URL_GEOJSON)


@responses.activate
def test_redirecionamento_para_fora_da_lista_nao_e_seguido():
    responses.get(URL_GEOJSON, status=302, headers={"Location": "https://exemplo.com/x"})
    responses.get("https://exemplo.com/x", json=colecao())
    with pytest.raises(ErroConector, match="lista de fontes permitidas"):
        seguranca.buscar(URL_GEOJSON)
    assert [c.request.url for c in responses.calls] == [URL_GEOJSON]


@responses.activate
def test_redirecionamento_para_http_ou_ip_privado_nao_e_seguido(monkeypatch):
    responses.get(URL_GEOJSON, status=301, headers={"Location": f"http://{HOST}/x"})
    with pytest.raises(ErroConector, match="HTTPS"):
        seguranca.buscar(URL_GEOJSON)


@responses.activate
def test_redirecionamento_dentro_da_lista_e_seguido():
    destino = "https://dados.fortaleza.ce.gov.br/dados.geojson"
    responses.get(URL_GEOJSON, status=302, headers={"Location": destino})
    responses.get(destino, json=colecao(ponto(-38.5, -3.8)))
    assert b"FeatureCollection" in seguranca.buscar(URL_GEOJSON)


@responses.activate
def test_laco_de_redirecionamentos_para():
    responses.get(URL_GEOJSON, status=302, headers={"Location": URL_GEOJSON})
    with pytest.raises(ErroConector, match="redirecionou mais vezes"):
        seguranca.buscar(URL_GEOJSON)
    assert len(responses.calls) == seguranca.MAX_REDIRECIONAMENTOS + 1


@responses.activate
def test_limite_de_bytes_lidos_por_streaming(settings):
    settings.ITREE_CONECTORES_MAX_BYTES = 1024
    responses.get(URL_GEOJSON, body=b"x" * 5000)
    with pytest.raises(ErroConector, match="limite"):
        seguranca.buscar(URL_GEOJSON)


@responses.activate
def test_limite_de_bytes_pelo_content_length_nem_comeca_a_ler(settings):
    settings.ITREE_CONECTORES_MAX_BYTES = 1024
    responses.get(URL_GEOJSON, body=b"x", headers={"Content-Length": "999999"})
    with pytest.raises(ErroConector, match="limite"):
        seguranca.buscar(URL_GEOJSON)


@responses.activate
def test_resposta_com_erro_da_fonte():
    responses.get(URL_GEOJSON, status=503)
    with pytest.raises(ErroConector, match="503"):
        seguranca.buscar(URL_GEOJSON)


@responses.activate
def test_tempo_limite_e_aplicado_e_a_falha_de_rede_vira_erro_do_conector(settings):
    settings.ITREE_CONECTORES_TIMEOUT = 7
    responses.get(URL_GEOJSON, body=requests.Timeout())
    with pytest.raises(ErroConector, match="Timeout"):
        seguranca.buscar(URL_GEOJSON)


def test_timeout_chega_a_requests(monkeypatch, settings):
    settings.ITREE_CONECTORES_TIMEOUT = 7
    vistos = {}

    def falso(url, **kwargs):
        vistos.update(kwargs)
        raise requests.Timeout

    monkeypatch.setattr(requests, "get", falso)
    with pytest.raises(ErroConector):
        seguranca.buscar(URL_GEOJSON)
    assert vistos["timeout"] == 7 and vistos["allow_redirects"] is False and vistos["stream"]


@responses.activate
def test_com_proxy_de_saida_quem_resolve_e_o_proxy(monkeypatch):
    """Sem DNS local (ambiente com egress controlado), a lista de hosts e o HTTPS continuam."""

    def sem_dns(host):
        raise ErroConector("sem dns")

    monkeypatch.setattr(seguranca, "_resolver", sem_dns)
    monkeypatch.setattr(seguranca, "_por_proxy", lambda url: True)
    servir(corpo=colecao())
    assert seguranca.buscar(URL_GEOJSON)
    with pytest.raises(ErroConector, match="lista de fontes permitidas"):
        seguranca.buscar("https://exemplo.com/x")


# --------------------------------------------------------------------------------------------
# Tipos de conector (respostas simuladas)
# --------------------------------------------------------------------------------------------


@responses.activate
def test_geojson_url():
    servir(corpo=colecao(ponto(-38.5, -3.8, id=1)))
    baixado = clientes.baixar("geojson_url", URL_GEOJSON, {})
    assert baixado.formato == "geojson" and len(json.loads(baixado.conteudo)["features"]) == 1


@responses.activate
def test_geojson_que_nao_e_colecao_e_recusado():
    responses.get(URL_GEOJSON, json={"type": "Point", "coordinates": [0, 0]})
    with pytest.raises(ErroConector, match="FeatureCollection"):
        clientes.baixar("geojson_url", URL_GEOJSON, {})


@responses.activate
def test_conteudo_que_nao_e_json_e_recusado():
    responses.get(URL_GEOJSON, body="<html>não é json</html>")
    with pytest.raises(ErroConector, match="GeoJSON válido"):
        clientes.baixar("geojson_url", URL_GEOJSON, {})


@responses.activate
def test_limite_de_feicoes(settings):
    settings.ITREE_CONECTORES_MAX_FEICOES = 2
    servir(corpo=colecao(*[ponto(-38.5, -3.8, id=i) for i in range(3)]))
    with pytest.raises(ErroConector, match="mais de 2 feições"):
        clientes.baixar("geojson_url", URL_GEOJSON, {})


@responses.activate
def test_wfs_pede_getfeature_em_geojson():
    url = f"https://{HOST}/geoserver/ows"
    responses.get(url, json=colecao(ponto(-38.5, -3.8, id=1)))
    baixado = clientes.baixar("wfs", url, {"camada": "ns:arvores"})
    pedido = responses.calls[0].request.params
    assert pedido["request"] == "GetFeature" and pedido["typeNames"] == "ns:arvores"
    assert pedido["outputFormat"] == "application/json" and pedido["srsName"] == "EPSG:4326"
    assert len(json.loads(baixado.conteudo)["features"]) == 1


def test_wfs_exige_a_camada():
    with pytest.raises(ErroConector, match="camada"):
        clientes.baixar("wfs", f"https://{HOST}/geoserver/ows", {})


@responses.activate
def test_arcgis_pagina_por_result_offset_ate_acabar():
    url = f"https://{HOST}/arcgis/rest/services/s/FeatureServer/0"
    paginas = [
        {
            **colecao(ponto(-38.5, -3.8, id=1), ponto(-38.5, -3.7, id=2)),
            "exceededTransferLimit": True,
        },
        {
            **colecao(ponto(-38.4, -3.8, id=3), ponto(-38.4, -3.7, id=4)),
            "exceededTransferLimit": True,
        },
        colecao(ponto(-38.3, -3.8, id=5)),
    ]
    for pagina in paginas:
        responses.add(responses.GET, f"{url}/query", json=pagina)
    baixado = clientes.baixar("arcgis_rest", url, {"tamanho_pagina": "2", "where": "ano=2024"})
    assert baixado.paginas == 3
    assert [f["properties"]["id"] for f in json.loads(baixado.conteudo)["features"]] == [
        1,
        2,
        3,
        4,
        5,
    ]
    chamadas = [c.request.params for c in responses.calls]
    assert [c["resultOffset"] for c in chamadas] == ["0", "2", "4"]
    assert chamadas[0]["f"] == "geojson" and chamadas[0]["where"] == "ano=2024"
    assert chamadas[0]["resultRecordCount"] == "2" and chamadas[0]["outSR"] == "4326"


@responses.activate
def test_arcgis_sem_flag_para_quando_a_pagina_vem_incompleta():
    url = f"https://{HOST}/arcgis/rest/services/s/MapServer/3/query"
    responses.add(responses.GET, url, json=colecao(ponto(-38.5, -3.8, id=1)))
    baixado = clientes.baixar("arcgis_rest", url, {"tamanho_pagina": "10"})
    assert baixado.paginas == 1 and len(responses.calls) == 1


@responses.activate
def test_arcgis_respeita_o_limite_de_paginas(settings):
    settings.ITREE_CONECTORES_MAX_PAGINAS = 2
    url = f"https://{HOST}/arcgis/rest/services/s/FeatureServer/0"
    responses.add(
        responses.GET,
        f"{url}/query",
        json={**colecao(ponto(-38.5, -3.8, id=1)), "exceededTransferLimit": True},
    )
    with pytest.raises(ErroConector, match="limite de 2 páginas"):
        clientes.baixar("arcgis_rest", url, {"tamanho_pagina": "1"})
    assert len(responses.calls) == 2


@responses.activate
def test_arcgis_respeita_o_limite_de_feicoes(settings):
    settings.ITREE_CONECTORES_MAX_FEICOES = 3
    url = f"https://{HOST}/arcgis/rest/services/s/FeatureServer/0"
    pagina = {
        **colecao(ponto(-38.5, -3.8, id=1), ponto(-38.5, -3.7, id=2)),
        "exceededTransferLimit": True,
    }
    responses.add(responses.GET, f"{url}/query", json=pagina)
    with pytest.raises(ErroConector, match="mais de 3 feições"):
        clientes.baixar("arcgis_rest", url, {"tamanho_pagina": "2"})


@responses.activate
def test_arcgis_com_erro_no_corpo_mostra_a_mensagem_da_fonte():
    url = f"https://{HOST}/arcgis/rest/services/s/FeatureServer/0"
    responses.add(
        responses.GET, f"{url}/query", json={"error": {"code": 400, "message": "Consulta inválida"}}
    )
    with pytest.raises(ErroConector, match="Consulta inválida"):
        clientes.baixar("arcgis_rest", url, {})


def pacote_ckan(*recursos):
    return {"success": True, "result": {"resources": list(recursos)}}


@responses.activate
def test_ckan_escolhe_o_recurso_geojson_antes_do_csv():
    base = "https://dados.fortaleza.ce.gov.br"
    responses.get(
        f"{base}/api/3/action/package_show",
        json=pacote_ckan(
            {"id": "r1", "format": "CSV", "url": f"{base}/dl/a.csv"},
            {"id": "r2", "format": "GeoJSON", "url": f"{base}/dl/a.geojson"},
        ),
    )
    responses.get(f"{base}/dl/a.geojson", json=colecao(ponto(-38.5, -3.8, id=1)))
    baixado = clientes.baixar("ckan", base, {"pacote": "podas"})
    assert baixado.formato == "geojson"
    assert responses.calls[0].request.params["id"] == "podas"


@responses.activate
def test_ckan_csv_e_recurso_escolhido_pelo_id():
    base = "https://dados.fortaleza.ce.gov.br"
    responses.get(
        f"{base}/api/3/action/package_show",
        json=pacote_ckan(
            {"id": "r1", "format": "GeoJSON", "url": f"{base}/dl/a.geojson"},
            {"id": "r2", "format": "CSV", "url": f"{base}/dl/a.csv"},
        ),
    )
    responses.get(f"{base}/dl/a.csv", body="lat,lon,nome\n-3.8,-38.5,A\n")
    baixado = clientes.baixar("ckan", base, {"pacote": "podas", "recurso": "r2"})
    assert baixado.formato == "csv" and b"lat,lon" in baixado.conteudo


@responses.activate
def test_ckan_recurso_em_host_fora_da_lista_nao_e_baixado():
    base = "https://dados.fortaleza.ce.gov.br"
    responses.get(
        f"{base}/api/3/action/package_show",
        json=pacote_ckan({"id": "r1", "format": "GeoJSON", "url": "https://exemplo.com/a.geojson"}),
    )
    with pytest.raises(ErroConector, match="lista de fontes permitidas"):
        clientes.baixar("ckan", base, {"pacote": "podas"})


@responses.activate
def test_ckan_sem_recurso_utilizavel_ou_pacote_inexistente():
    base = "https://dados.fortaleza.ce.gov.br"
    responses.get(
        f"{base}/api/3/action/package_show",
        json=pacote_ckan({"id": "r1", "format": "PDF", "url": f"{base}/a.pdf"}),
    )
    with pytest.raises(ErroConector, match="nem CSV"):
        clientes.baixar("ckan", base, {"pacote": "podas"})
    responses.replace(responses.GET, f"{base}/api/3/action/package_show", json={"success": False})
    with pytest.raises(ErroConector, match="não encontrou"):
        clientes.baixar("ckan", base, {"pacote": "podas"})


# --------------------------------------------------------------------------------------------
# Leitura das feições (dado não confiável)
# --------------------------------------------------------------------------------------------


def baixado_de(*feicoes) -> clientes.Baixado:
    return clientes.Baixado("geojson", json.dumps(colecao(*feicoes)).encode())


def test_leitura_descarta_z_e_usa_a_propriedade_como_id_externo():
    feicoes, recebidas, invalidas = servico.ler_feicoes(
        baixado_de(ponto(-38.5, -3.8, 0, id=7, name="A")), {"campo_id": "id"}
    )
    assert (recebidas, invalidas) == (1, 0)
    assert feicoes[0]["id_externo"] == "7"
    assert not feicoes[0]["geom"].hasz and feicoes[0]["geom"].srid == 4326


def test_id_do_proprio_feature_quando_nao_ha_campo_e_hash_estavel_sem_id():
    com_id = {**ponto(-38.5, -3.8), "id": "abc"}
    assert servico.ler_feicoes(baixado_de(com_id), {})[0][0]["id_externo"] == "abc"
    a = servico.ler_feicoes(baixado_de(ponto(-38.5, -3.8, nome="x")), {})[0][0]["id_externo"]
    b = servico.ler_feicoes(baixado_de(ponto(-38.5, -3.8, nome="x")), {})[0][0]["id_externo"]
    c = servico.ler_feicoes(baixado_de(ponto(-38.5, -3.8, nome="y")), {})[0][0]["id_externo"]
    assert a == b != c and a.startswith("h-")


def test_feicoes_invalidas_sao_contadas_e_nao_entram():
    feicoes, recebidas, invalidas = servico.ler_feicoes(
        baixado_de(
            ponto(-38.5, -3.8, id=1),
            {"type": "Feature", "geometry": None, "properties": {"id": 2}},
            ponto(500, 200, id=3),  # fora do globo
            {"type": "Feature", "geometry": {"type": "Foo", "coordinates": []}, "properties": {}},
            ponto(-38.4, -3.8, id=1),  # identificador repetido
            "não é feição",
        ),
        {"campo_id": "id"},
    )
    assert [f["id_externo"] for f in feicoes] == ["1"]
    assert (recebidas, invalidas) == (6, 5)


def test_poligono_com_autointerseccao_e_consertado():
    gravata = {
        "type": "Feature",
        "properties": {"id": 1},
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]],
        },
    }
    feicoes, _, invalidas = servico.ler_feicoes(baixado_de(gravata), {"campo_id": "id"})
    assert invalidas == 0 and feicoes[0]["geom"].valid


def test_csv_vira_pontos_pelas_colunas_de_latitude_e_longitude():
    csv = "Latitude;Longitude;nome\n-3,8;-38,5;Praça\n;;sem ponto\n"
    feicoes, recebidas, invalidas = servico.ler_feicoes(clientes.Baixado("csv", csv.encode()), {})
    assert (recebidas, invalidas) == (2, 1)
    assert feicoes[0]["geom"].coords == (-38.5, -3.8)
    assert feicoes[0]["propriedades"] == {"nome": "Praça"}


def test_csv_sem_colunas_de_coordenadas_e_erro():
    with pytest.raises(ErroConector, match="latitude e longitude"):
        servico.ler_feicoes(clientes.Baixado("csv", b"a,b\n1,2\n"), {})


def test_conteudo_baixado_nunca_e_interpretado_como_codigo():
    """HTML e marcadores nas propriedades ficam como texto, sem efeito."""
    malicioso = ponto(-38.5, -3.8, id=1, description="<script>alert(1)</script>__import__('os')")
    feicoes, _, _ = servico.ler_feicoes(baixado_de(malicioso), {"campo_id": "id"})
    assert feicoes[0]["propriedades"]["description"].startswith("<script>")


# --------------------------------------------------------------------------------------------
# Camada de referência: substituição atômica e execuções
# --------------------------------------------------------------------------------------------


@responses.activate
def test_sincronizar_camada_conta_novos_atualizados_removidos():
    conector = criar_conector()
    servir(corpo=colecao(ponto(-38.5, -3.8, id=1, n="a"), ponto(-38.5, -3.7, id=2, n="b")))
    primeira = servico.sincronizar(conector)
    assert primeira.sucesso and (primeira.recebidos, primeira.novos) == (2, 2)
    assert FeicaoReferencia.objects.filter(conector=conector).count() == 2

    responses.replace(
        responses.GET,
        URL_GEOJSON,
        json=colecao(ponto(-38.5, -3.8, id=1, n="a"), ponto(-38.4, -3.7, id=3, n="c")),
    )
    segunda = servico.sincronizar(conector)
    assert (segunda.novos, segunda.atualizados, segunda.removidos) == (1, 0, 1)

    responses.replace(
        responses.GET,
        URL_GEOJSON,
        json=colecao(ponto(-38.5, -3.8, id=1, n="mudou"), ponto(-38.4, -3.7, id=3, n="c")),
    )
    terceira = servico.sincronizar(conector)
    assert (terceira.novos, terceira.atualizados, terceira.removidos) == (0, 1, 0)
    assert sorted(
        FeicaoReferencia.objects.filter(conector=conector).values_list("id_externo", flat=True)
    ) == ["1", "3"]
    assert terceira.concluida_em is not None


@responses.activate
def test_feicao_invalida_conta_e_nao_impede_a_sincronizacao():
    conector = criar_conector()
    servir(
        corpo=colecao(
            ponto(-38.5, -3.8, id=1), {"type": "Feature", "geometry": None, "properties": {}}
        )
    )
    execucao = servico.sincronizar(conector)
    assert execucao.sucesso and (execucao.recebidos, execucao.invalidos) == (2, 1)


@responses.activate
def test_substituicao_e_atomica_se_a_gravacao_falha_a_camada_antiga_fica(monkeypatch):
    conector = criar_conector()
    servir(corpo=colecao(ponto(-38.5, -3.8, id=1), ponto(-38.5, -3.7, id=2)))
    servico.sincronizar(conector)

    def quebrar(*args, **kwargs):
        raise RuntimeError("falha no meio da gravação")

    monkeypatch.setattr(FeicaoReferencia.objects, "bulk_create", quebrar)
    responses.replace(responses.GET, URL_GEOJSON, json=colecao(ponto(-38.1, -3.1, id=9)))
    execucao = servico.sincronizar(conector)
    assert not execucao.sucesso and "RuntimeError" in execucao.erro
    assert sorted(
        FeicaoReferencia.objects.filter(conector=conector).values_list("id_externo", flat=True)
    ) == ["1", "2"]


@responses.activate
def test_falha_da_fonte_fica_registrada_e_a_camada_antiga_permanece():
    conector = criar_conector()
    servir(corpo=colecao(ponto(-38.5, -3.8, id=1)))
    servico.sincronizar(conector)
    responses.replace(responses.GET, URL_GEOJSON, status=500)
    execucao = servico.sincronizar(conector)
    assert not execucao.sucesso and "500" in execucao.erro and execucao.concluida_em
    assert FeicaoReferencia.objects.filter(conector=conector).count() == 1


def test_host_removido_da_lista_faz_a_execucao_falhar_sem_buscar(settings):
    conector = criar_conector()
    settings.ITREE_CONECTORES_HOSTS_PERMITIDOS = ["dados.fortaleza.ce.gov.br"]
    execucao = servico.sincronizar(conector)
    assert not execucao.sucesso and "lista de fontes permitidas" in execucao.erro


@responses.activate
def test_execucao_simultanea_e_recusada_mas_a_interrompida_nao_bloqueia():
    conector = criar_conector()
    aberta = servico.iniciar_execucao(conector)
    with pytest.raises(servico.ExecucaoEmAndamento):
        servico.iniciar_execucao(conector)
    ExecucaoConector.objects.filter(pk=aberta.pk).update(
        iniciada_em=timezone.now() - timedelta(hours=2)
    )
    assert servico.iniciar_execucao(conector)


# --------------------------------------------------------------------------------------------
# Destino lote de importação: prévia, nunca confirma
# --------------------------------------------------------------------------------------------


@pytest.fixture
def modelo_importacao(db):
    return ModeloImportacao.objects.create(
        nome="Atendimentos",
        fonte="Fortaleza em Mapas",
        mapeamento={"id_externo": "id", "especie": "especie"},
    )


def conector_de_lote(revisor, modelo, **extras):
    return criar_conector(
        nome="Inventário externo",
        destino="lote_importacao",
        modelo_importacao=modelo,
        modo="atualizar",
        criado_por=revisor,
        parametros={},
        **extras,
    )


FEICOES_LOTE = colecao(
    ponto(-38.555, -3.755, id="A1", especie="Oiti"),
    ponto(-38.554, -3.754, id="A2", especie="Oiti"),
)


@responses.activate
def test_lote_nasce_em_previa_com_modelo_e_modo_do_conector(revisor, modelo_importacao):
    conector = conector_de_lote(revisor, modelo_importacao)
    servir(corpo=FEICOES_LOTE)
    execucao = servico.sincronizar(conector)
    assert execucao.sucesso, execucao.erro
    lote = LoteImportacao.objects.get()
    assert execucao.lote == lote
    assert lote.estado == EstadoLote.PRE_VISUALIZADO
    assert lote.modo == "atualizar" and lote.usuario == revisor
    assert lote.fonte == "Fortaleza em Mapas" and lote.formato == "geojson"
    assert lote.mapeamento["id_externo"] == "id" and lote.mapeamento["fonte_ids"] == lote.fonte
    assert lote.total_linhas == 2 and lote.resumo["a_criar"] == 2
    assert (execucao.recebidos, execucao.novos) == (2, 2)
    # Prévia não é importação: nada foi confirmado, nenhuma árvore existe.
    assert lote.confirmado_em is None and not Arvore.objects.exists()


@responses.activate
def test_previa_aguardando_gera_notificacao_para_quem_importa(
    revisor, tecnico_a, modelo_importacao, django_capture_on_commit_callbacks
):
    conector = conector_de_lote(revisor, modelo_importacao)
    servir(corpo=FEICOES_LOTE)
    with django_capture_on_commit_callbacks(execute=True):
        servico.sincronizar(conector)
    avisos = Notificacao.objects.filter(tipo="previa_importacao")
    assert {a.usuario for a in avisos} == {revisor}  # o técnico não importa inventário
    assert "Inventário externo" in avisos[0].titulo
    assert avisos[0].link == "/inventario/importacoes"


@responses.activate
def test_nova_sincronizacao_nao_acumula_previas(revisor, modelo_importacao):
    conector = conector_de_lote(revisor, modelo_importacao)
    servir(corpo=FEICOES_LOTE)
    servico.sincronizar(conector)
    segunda = servico.sincronizar(conector)
    assert segunda.sucesso and segunda.lote is None
    assert "aguarda confirmação" in segunda.detalhe
    assert LoteImportacao.objects.count() == 1
    LoteImportacao.objects.update(estado=EstadoLote.DESCARTADO)
    assert servico.sincronizar(conector).lote is not None
    assert LoteImportacao.objects.count() == 2


@responses.activate
def test_lote_sem_responsavel_ativo_falha_com_mensagem(modelo_importacao):
    conector = conector_de_lote(None, modelo_importacao)
    servir(corpo=FEICOES_LOTE)
    execucao = servico.sincronizar(conector)
    assert not execucao.sucesso and "responsável" in execucao.erro
    assert not LoteImportacao.objects.exists()


@responses.activate
def test_lote_usa_a_pessoa_que_pediu_a_sincronizacao(revisor, gestor_municipal, modelo_importacao):
    conector = conector_de_lote(revisor, modelo_importacao)
    servir(corpo=FEICOES_LOTE)
    servico.sincronizar(conector, usuario=gestor_municipal)
    assert LoteImportacao.objects.get().usuario == gestor_municipal


# --------------------------------------------------------------------------------------------
# Agendamento (beat) e situação
# --------------------------------------------------------------------------------------------


def execucao_em(conector, quando, sucesso=True):
    execucao = ExecucaoConector.objects.create(
        conector=conector, sucesso=sucesso, concluida_em=quando
    )
    ExecucaoConector.objects.filter(pk=execucao.pk).update(iniciada_em=quando)
    execucao.refresh_from_db()
    return execucao


@pytest.mark.parametrize(
    ("periodicidade", "dias", "vence"),
    [
        ("diaria", 0.5, False),
        ("diaria", 1, True),
        ("semanal", 6, False),
        ("semanal", 7, True),
        ("mensal", 29, False),
        ("mensal", 31, True),
        ("manual", 400, False),
    ],
)
def test_vencimento_pela_periodicidade(periodicidade, dias, vence):
    conector = criar_conector(periodicidade=periodicidade)
    execucao_em(conector, timezone.now() - timedelta(days=dias))
    assert servico.vencido(conector) is vence


def test_vence_logo_se_nunca_rodou_mas_nao_se_inativo():
    assert servico.vencido(criar_conector(periodicidade="diaria"))
    assert not servico.vencido(criar_conector(nome="Inativo", periodicidade="diaria", ativo=False))


def test_beat_dispara_so_os_vencidos(monkeypatch):
    vencido = criar_conector(nome="Vencido", periodicidade="diaria")
    recente = criar_conector(nome="Recente", periodicidade="diaria")
    criar_conector(nome="Manual", periodicidade="manual")
    execucao_em(vencido, timezone.now() - timedelta(days=2))
    execucao_em(recente, timezone.now() - timedelta(hours=2))
    enfileiradas = []
    monkeypatch.setattr(
        tasks.sincronizar_conector, "delay", lambda execucao_id: enfileiradas.append(execucao_id)
    )
    # Já havia execução fechada; o conector "Manual" nunca roda sozinho.
    assert tasks.disparar_conectores_vencidos() == 1
    execucao = ExecucaoConector.objects.get(pk=enfileiradas[0])
    assert execucao.conector == vencido and execucao.origem == "agendada"
    assert execucao.usuario is None
    # Executado agora mesmo, o conector deixa de estar vencido: o beat não repete.
    assert tasks.disparar_conectores_vencidos() == 0


def test_beat_pula_conector_ja_em_execucao(monkeypatch):
    conector = criar_conector(periodicidade="diaria")
    servico.iniciar_execucao(conector)
    ExecucaoConector.objects.update(iniciada_em=timezone.now() - timedelta(days=3))
    ExecucaoConector.objects.filter(conector=conector).update(
        iniciada_em=timezone.now() - timedelta(minutes=5)
    )
    monkeypatch.setattr(tasks.sincronizar_conector, "delay", lambda *a: pytest.fail("enfileirou"))
    assert tasks.disparar_conectores_vencidos() == 0


@responses.activate
def test_tarefa_sincronizar_executa_e_ignora_execucao_ja_concluida():
    conector = criar_conector()
    servir(corpo=colecao(ponto(-38.5, -3.8, id=1)))
    execucao = servico.iniciar_execucao(conector)
    assert tasks.sincronizar_conector(execucao.pk) is True
    assert tasks.sincronizar_conector(execucao.pk) is None  # já concluída
    assert FeicaoReferencia.objects.count() == 1


def test_o_beat_esta_agendado():
    from django.conf import settings

    entrada = settings.CELERY_BEAT_SCHEDULE["disparar-conectores"]
    assert entrada["task"] == "itree.conectores.tasks.disparar_conectores_vencidos"


def test_situacao_do_conector():
    agora = timezone.now()
    conector = criar_conector(periodicidade="diaria")
    assert servico.situacao(conector, None) == "nunca"
    ok = execucao_em(conector, agora - timedelta(hours=3))
    assert servico.situacao(conector, ok) == "ok"
    atrasada = execucao_em(conector, agora - timedelta(days=3))
    assert servico.situacao(conector, atrasada) == "atrasado"
    falha = execucao_em(conector, agora - timedelta(hours=1), sucesso=False)
    assert servico.situacao(conector, falha) == "falha"
    aberta = ExecucaoConector.objects.create(conector=conector)
    assert servico.situacao(conector, aberta) == "sincronizando"
    manual = criar_conector(nome="M", periodicidade="manual")
    antiga = execucao_em(manual, agora - timedelta(days=90))
    assert servico.situacao(manual, antiga) == "ok"  # manual não "atrasa"


# --------------------------------------------------------------------------------------------
# API: permissões, validação, teste de conexão, histórico
# --------------------------------------------------------------------------------------------

CORPO = {
    "nome": "Atendimentos",
    "tipo": "geojson_url",
    "url": URL_GEOJSON,
    "parametros": {"campo_id": "id"},
    "destino": "camada_referencia",
    "periodicidade": "mensal",
    "orgao": "Prefeitura de Fortaleza",
    "licenca": "Não declarada pela fonte",
    "url_origem": f"https://{HOST}/",
}


def test_so_admin_configuracao_cria_edita_testa_e_sincroniza(cliente, admin, revisor, tecnico_a):
    conector = criar_conector()
    for usuario in (revisor, tecnico_a):
        cliente.como(usuario)
        assert cliente.get(URL).status_code == 403
        assert cliente.get(f"{URL}/{conector.pk}").status_code == 403
        assert cliente.post(URL, CORPO, format="json").status_code == 403
        assert (
            cliente.patch(f"{URL}/{conector.pk}", {"ativo": False}, format="json").status_code
            == 403
        )
        assert cliente.post(f"{URL}/testar", CORPO, format="json").status_code == 403
        assert cliente.post(f"{URL}/{conector.pk}/sincronizar").status_code == 403
        assert cliente.get(f"{URL}/{conector.pk}/execucoes").status_code == 403
    conector.refresh_from_db()
    assert conector.ativo and not ExecucaoConector.objects.exists()
    cliente.como(admin)
    assert cliente.get(URL).status_code == 200


def test_criar_registra_responsavel_e_auditoria(cliente, admin):
    cliente.como(admin)
    r = cliente.post(URL, CORPO, format="json")
    assert r.status_code == 201, r.json()
    conector = Conector.objects.get()
    assert conector.criado_por == admin and conector.ativo is False
    assert r.json()["situacao"] == "nunca" and r.json()["total_feicoes"] == 0
    cliente.patch(f"{URL}/{conector.pk}", {"ativo": True}, format="json")
    assert ConectorEvent.objects.filter(pgh_obj_id=conector.pk).count() >= 2  # criação e alteração


@pytest.mark.parametrize(
    ("campo", "valor", "trecho"),
    [
        ("url", f"http://{HOST}/x", "HTTPS"),
        ("url", "https://exemplo.com/x", "lista de fontes permitidas"),
        ("url", f"https://u:s@{HOST}/x", "usuário"),
        ("orgao", "", "branco"),
        ("licenca", "", "branco"),
        ("url_origem", "", "branco"),
        ("cor", "#12345", "#rrggbb"),
        ("parametros", {"desconhecido": "1"}, "não reconhecidos"),
    ],
)
def test_validacoes_do_cadastro(cliente, admin, campo, valor, trecho):
    cliente.como(admin)
    r = cliente.post(URL, {**CORPO, campo: valor}, format="json")
    assert r.status_code == 400
    assert trecho.lower() in json.dumps(r.json(), ensure_ascii=False).lower()
    assert not Conector.objects.exists()


def test_parametros_obrigatorios_por_tipo_e_modelo_para_lote(cliente, admin):
    cliente.como(admin)
    r = cliente.post(URL, {**CORPO, "tipo": "wfs", "parametros": {}}, format="json")
    assert r.status_code == 400 and "camada" in json.dumps(r.json())
    r = cliente.post(URL, {**CORPO, "tipo": "ckan", "parametros": {}}, format="json")
    assert r.status_code == 400 and "pacote" in json.dumps(r.json())
    r = cliente.post(URL, {**CORPO, "destino": "lote_importacao"}, format="json")
    assert r.status_code == 400 and "modelo_importacao" in r.json()


def test_nome_unico(cliente, admin):
    cliente.como(admin)
    assert cliente.post(URL, CORPO, format="json").status_code == 201
    assert cliente.post(URL, CORPO, format="json").status_code == 400


@responses.activate
def test_teste_de_conexao_mostra_total_e_colunas_sem_gravar(cliente, admin):
    servir(corpo=colecao(*[ponto(-38.5, -3.8, id=i, name=f"P{i}") for i in range(5)]))
    cliente.como(admin)
    r = cliente.post(f"{URL}/testar", CORPO, format="json")
    assert r.status_code == 200, r.json()
    assert r.json()["total"] == 5 and r.json()["colunas"] == ["id", "name"]
    assert len(r.json()["amostra"]) == 3 and r.json()["amostra"][0]["name"] == "P0"
    assert not Conector.objects.exists() and not FeicaoReferencia.objects.exists()
    assert not ExecucaoConector.objects.exists()


@responses.activate
def test_teste_de_conexao_com_falha_devolve_400_com_a_mensagem(cliente, admin):
    responses.get(URL_GEOJSON, status=503)
    cliente.como(admin)
    r = cliente.post(f"{URL}/testar", CORPO, format="json")
    assert r.status_code == 400 and "503" in r.json()["detail"]


def test_teste_de_conexao_recusa_host_fora_da_lista(cliente, admin):
    cliente.como(admin)
    r = cliente.post(f"{URL}/testar", {**CORPO, "url": "https://exemplo.com/x"}, format="json")
    assert r.status_code == 400


@responses.activate
def test_sincronizar_pela_api_enfileira_e_o_historico_mostra(cliente, admin, monkeypatch):
    conector = criar_conector()
    servir(corpo=colecao(ponto(-38.5, -3.8, id=1)))
    monkeypatch.setattr(
        tasks.sincronizar_conector, "delay", lambda i: tasks.sincronizar_conector(i)
    )
    cliente.como(admin)
    r = cliente.post(f"{URL}/{conector.pk}/sincronizar")
    assert r.status_code == 202, r.json()
    assert r.json()["usuario_nome"] == admin.nome and r.json()["origem"] == "manual"
    historico = cliente.get(f"{URL}/{conector.pk}/execucoes").json()
    assert len(historico) == 1 and historico[0]["sucesso"] and historico[0]["novos"] == 1
    detalhe = cliente.get(f"{URL}/{conector.pk}").json()
    assert detalhe["situacao"] == "ok" and detalhe["total_feicoes"] == 1
    assert detalhe["ultima_execucao"]["recebidos"] == 1


def test_sincronizar_com_execucao_em_andamento_devolve_409(cliente, admin, monkeypatch):
    conector = criar_conector()
    servico.iniciar_execucao(conector)
    monkeypatch.setattr(tasks.sincronizar_conector, "delay", lambda i: pytest.fail("enfileirou"))
    cliente.como(admin)
    assert cliente.post(f"{URL}/{conector.pk}/sincronizar").status_code == 409


def test_sem_fila_a_execucao_nao_fica_pendurada(cliente, admin, monkeypatch):
    conector = criar_conector()

    def sem_redis(i):
        raise ConnectionError("redis fora")

    monkeypatch.setattr(tasks.sincronizar_conector, "delay", sem_redis)
    cliente.como(admin)
    r = cliente.post(f"{URL}/{conector.pk}/sincronizar")
    assert r.status_code == 202 and "fila" in r.json()["erro"] and r.json()["concluida_em"]
    assert cliente.get(f"{URL}/{conector.pk}").json()["situacao"] == "falha"


def test_lista_traz_a_situacao_de_cada_conector(cliente, admin):
    ok = criar_conector(nome="Ok")
    execucao_em(ok, timezone.now() - timedelta(hours=1))
    ruim = criar_conector(nome="Ruim")
    execucao_em(ruim, timezone.now(), sucesso=False)
    criar_conector(nome="Novo")
    cliente.como(admin)
    por_nome = {c["nome"]: c["situacao"] for c in cliente.get(URL).json()}
    assert por_nome == {"Ok": "ok", "Ruim": "falha", "Novo": "nunca"}


# --------------------------------------------------------------------------------------------
# API do mapa: camadas de referência
# --------------------------------------------------------------------------------------------


@responses.activate
def test_mapa_lista_so_camadas_de_referencia_ativas_com_atribuicao(
    cliente, tecnico_a, modelo_importacao, revisor
):
    ativo = criar_conector(nome="Ativo", rotulos={"name": "Endereço"})
    criar_conector(nome="Inativo", ativo=False)
    conector_de_lote(revisor, modelo_importacao)
    servir(corpo=colecao(ponto(-38.5, -3.8, id=1)))
    servico.sincronizar(ativo)
    cliente.como(tecnico_a)
    camadas = cliente.get("/api/v1/mapa/camadas-referencia").json()
    assert [c["nome"] for c in camadas] == ["Ativo"]
    camada = camadas[0]
    assert camada["total"] == 1 and camada["rotulos"] == {"name": "Endereço"}
    assert camada["orgao"] and camada["licenca"] and camada["url_origem"] and camada["cor"]
    assert camada["atualizada_em"]


@responses.activate
def test_mapa_serve_o_geojson_da_camada_ativa(cliente, tecnico_a):
    conector = criar_conector()
    servir(corpo=colecao(ponto(-38.5, -3.8, 0, id=1, name="Rua A")))
    servico.sincronizar(conector)
    cliente.como(tecnico_a)
    r = cliente.get(f"/api/v1/mapa/camadas-referencia/{conector.pk}")
    assert r.status_code == 200
    feicao = r.json()["features"][0]
    assert feicao["geometry"]["coordinates"] == [-38.5, -3.8]
    assert feicao["properties"]["name"] == "Rua A" and feicao["id"] == "1"


def test_mapa_nao_serve_camada_inativa_nem_de_lote(cliente, tecnico_a, modelo_importacao, revisor):
    inativo = criar_conector(nome="Inativo", ativo=False)
    lote = conector_de_lote(revisor, modelo_importacao)
    cliente.como(tecnico_a)
    assert cliente.get(f"/api/v1/mapa/camadas-referencia/{inativo.pk}").status_code == 404
    assert cliente.get(f"/api/v1/mapa/camadas-referencia/{lote.pk}").status_code == 404


def test_mapa_exige_permissao_de_leitura_do_mapa(cliente, db):
    from tests.conftest import criar_usuario

    sem_mapa = criar_usuario("sem@itree.teste", [])
    conector = criar_conector()
    cliente.como(sem_mapa)
    assert cliente.get("/api/v1/mapa/camadas-referencia").status_code == 403
    assert cliente.get(f"/api/v1/mapa/camadas-referencia/{conector.pk}").status_code == 403


# --------------------------------------------------------------------------------------------
# Comando de exemplo
# --------------------------------------------------------------------------------------------


def test_comando_cria_o_conector_de_exemplo_inativo_e_nao_duplica():
    from django.core.management import call_command

    call_command("criar_conectores_exemplo")
    call_command("criar_conectores_exemplo")
    conector = Conector.objects.get()
    assert conector.nome == "Atendimentos do Plano de Arborização"
    assert conector.ativo is False and conector.destino == "camada_referencia"
    assert conector.url == "https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=534"
    assert conector.parametros == {"campo_id": "id"}
    assert conector.orgao and conector.licenca and conector.url_origem
    assert not Arvore.objects.exists()  # contexto, não inventário (DP-18)
