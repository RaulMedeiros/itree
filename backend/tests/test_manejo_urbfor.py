"""Manejo de árvores da URBFOR (F-04): leitura das planilhas reais, agregação por bairro e
mês, indicadores externos e a análise "Manejo registrado pela URBFOR (2023)".

Os arquivos ``tests/dados/urbfor_*.csv`` são do dado real do CKAN de Fortaleza (dataset
``podas_recolhimento_supressao``, ISO-8859-1, ``;``), obtido em 2026-11-12: ``urbfor_jan2023.csv``
é a planilha inteira, e os ``*_trecho.csv`` têm o título, o cabeçalho e linhas reais escolhidas
pelos formatos difíceis (datas "3105/2023", "19/05/23" e "27/1//2023", trechos separados por
espaços, bairros ambíguos). Os 121 bairros são os do Fortaleza em Mapas (mapa 21). Nenhum teste
usa rede.
"""

import io
import json
from datetime import date
from pathlib import Path

import pytest
import responses
from django.core.management import call_command
from django.core.management.base import CommandError

from itree.indicadores import manejo_urbfor as m
from itree.indicadores.models import IndicadorTerritorialExterno
from itree.inventario.models import Arvore
from itree.ocorrencias.models import Ocorrencia
from itree.territorio.models import Territorio

from .conftest import com_escopo, criar_territorio, criar_usuario, quadrado

pytestmark = pytest.mark.django_db

DADOS = Path(__file__).parent / "dados"
JAN = DADOS / "urbfor_jan2023.csv"
MAR = DADOS / "urbfor_mar2023_trecho.csv"
MAI = DADOS / "urbfor_mai2023_trecho.csv"
JUN = DADOS / "urbfor_jun2023_trecho.csv"
AGO = DADOS / "urbfor_ago2023_trecho.csv"
NOV = DADOS / "urbfor_nov2023_trecho.csv"
BAIRROS_MAPAS = json.loads((DADOS / "fortaleza_em_mapas_bairros_regionais.json").read_text())
URL_ANALISE = "/api/v1/relatorios/analise"
ANALISE = {"analise": "manejo_urbfor_por_bairro"}


@pytest.fixture
def fortaleza(db):
    """Município, 12 regionais e os 121 bairros reais, cada bairro num quadrado de uma grade."""
    municipio = criar_territorio("Fortaleza", tipo="municipio", geom=quadrado(-38.7, -3.95, 0.4))
    regionais = {
        n: criar_territorio(f"SER {n}", tipo="regional", codigo=str(n), geom=quadrado(-38.6, -3.8))
        for n in range(1, 13)
    }
    for r in regionais.values():
        Territorio.objects.filter(pk=r.pk).update(pai=municipio)
    bairros = {}
    for i, b in enumerate(BAIRROS_MAPAS):
        numero = int(b["Regional Atual"].rsplit(" ", 1)[1])
        t = criar_territorio(
            b["Nome"],
            codigo=str(2304400000 + i),
            geom=quadrado(-38.69 + (i % 11) * 0.03, -3.94 + (i // 11) * 0.03, 0.02),
        )
        Territorio.objects.filter(pk=t.pk).update(pai=regionais[numero])
        bairros[b["Nome"]] = Territorio.objects.get(pk=t.pk)
    return {"municipio": municipio, "regionais": regionais, "bairros": bairros}


def _importar(*arquivos, **opts):
    saida = io.StringIO()
    call_command(
        "importar_manejo_urbfor", *[a for f in arquivos for a in ("--arquivo", str(f))],
        stdout=saida, **opts,
    )  # fmt: skip
    return saida.getvalue()


def _indice(fortaleza):
    return m.IndiceBairros.de(fortaleza["bairros"].values())


def _bairro(fortaleza, descricao):
    achado = m.bairro_do_servico(descricao, _indice(fortaleza))
    return achado.nome if isinstance(achado, Territorio) else achado


# --- Leitura do formato real -----------------------------------------------------


def test_planilha_inteira_de_janeiro_bate_com_a_linha_total():
    leitura = m.ler_mes(JAN.read_bytes())
    assert (leitura.ano, leitura.mes, len(leitura.servicos)) == (2023, 1, 174)
    # A linha "TOTAL" da própria URBFOR confere com a soma das 174 linhas de serviço.
    assert leitura.total_declarado == {"poda": 1032, "supressao": 82, "recolhimento": 119}
    assert leitura.total_lido == leitura.total_declarado
    primeiro = leitura.servicos[0]
    assert primeiro.regional == 1
    assert primeiro.quantidades == {"poda": 1, "supressao": 0, "recolhimento": 0}
    assert "Antonino Fontenele" in primeiro.descricao


def test_aceita_os_formatos_de_data_e_regional_do_dado_real():
    mai = m.ler_mes(MAI.read_bytes())
    assert (mai.ano, mai.mes, len(mai.servicos)) == (2023, 5, 9)  # inclui "3105/2023" e "19/05/23"
    assert {s.regional for s in mai.servicos} == {4, 10, 11, 12}
    nov = m.ler_mes(NOV.read_bytes())
    assert len(nov.servicos) == 5 and nov.servicos[0].regional == 8  # "27/1//2023", "SER 8"
    mar = m.ler_mes(MAR.read_bytes())
    assert {s.regional for s in mar.servicos} == {1, 2}  # " SER 01", "SER 01 "


def test_o_mes_e_o_do_arquivo_e_nao_o_da_data_da_linha():
    jun = m.ler_mes(JUN.read_bytes())
    assert jun.mes == 6
    assert sum(s.data_fora_do_mes for s in jun.servicos) == 1  # a linha de 29/07/2023


def test_arquivo_fora_do_formato():
    with pytest.raises(m.ManejoInvalido, match="Cabeçalho"):
        m.ler_mes(b"a;b\n1;2\n")
    sem_titulo = "MES (2023);;\nDATA;DESCRIÇÃO;Regional;Porte;Poda;Supressão;Recolhimento\n1/1/2023;x;SER 1;G;1;;\n"
    with pytest.raises(m.ManejoInvalido, match="Título"):
        m.ler_mes(sem_titulo.encode())


# --- Bairro pelo texto -----------------------------------------------------------


@pytest.mark.parametrize(
    ("descricao", "esperado"),
    [
        ("PODA de 01 árvore na Rua Antonino Fontenele, 199 - Alvaro Weyne", "Álvaro Weyne"),
        ("Poda de 27 árvores na Av. Humberto Monte, Bela Vista.", "Bela Vista"),
        ("Poda de 01 árvore na Rua 107, 100, Mondubim.", "Mondubim"),
        ("Poda de 02 árvores na Av. E, Vila Velha", "Vila Velha"),
        # duas ações no mesmo lugar, ligadas por " + "
        ("Poda de 17 árvores + Supressão de 02 árvores na Rua Jorge Dumar, Montese", "Montese"),
        # trechos separados por quebra de linha ou espaços em série, todos no mesmo bairro
        (
            "PODA de 02 árvores na Rua Gama - Vila Velha"
            + " " * 40
            + "SUPRESSÃO de 01 na Rua Gama - Vila Velha",
            "Vila Velha",
        ),
        (
            "PODA de 49 árvores na Rua G - Floresta \nSUPRESSÃO de 01 árvore na Rua G - Floresta",
            "Floresta",
        ),
        # parênteses finais, prefixo "Bairro" e abreviação "Conj."
        (
            "Poda de 03 árvores na Av. X - Parque Dois Irmãos (Loteamento Expedicionários)",
            "Parque Dois Irmãos",
        ),
        ("Poda de 03 árvores na Av. X - Bairro Ellery", "Ellery"),
        ("Poda de 03 árvores na Av. X, Conj. Palmeiras", "Conjunto Palmeiras"),
        # grafias da URBFOR que não são o nome oficial
        ("Recolhimento de 01 algaroba na Av I, 560, José Walter", "Prefeito José Walter"),
        ("Poda de 08 árvores na Av. X - Luciano Cavalcante", "Engenheiro Luciano Cavalcante"),
        ("Poda de 08 árvores na Av. X - São João do Tauape", "Tauape"),
        ("Poda de 08 árvores na Av. X - Vicente Pizon", "Vicente Pinzón"),
        ("Poda de 08 árvores na Av. X - Joquéi Club".replace("Joquéi", "Jóquei"), "Jóquei Clube"),
        ("Poda de 08 árvores na Av. X, Boa Vista", "Boa Vista / Castelão"),
    ],
)
def test_bairro_do_servico(fortaleza, descricao, esperado):
    assert _bairro(fortaleza, descricao) == esperado


@pytest.mark.parametrize(
    ("descricao", "esperado"),
    [
        # Nome que serve a dois bairros (I e II): ambíguo, nunca chuta.
        ("Poda de 27 árvores e supressão de 06 árvores na Av Clovis Arrais, Praia do Futuro", m.AMBIGUO),
        ("Poda de 03 árvores na Av. X, Conj. Ceará", m.AMBIGUO),
        ("Supressão de 01 árvore na Av. César Cals, 2370, Praia do Futuro I.", "Praia do Futuro I"),
        # Sem bairro no texto, mutirão, número solto ou trechos em bairros diferentes.
        ("Poda de 106 árvores na Av. José Bastos e Av. Américo Barreira - MULTIRÃO", m.NAO_IDENTIFICADO),
        ("Poda de 10 árvores no Passeio Público", m.NAO_IDENTIFICADO),
        ("Poda de 10 árvores na Rua A, n° 330", m.NAO_IDENTIFICADO),
        ("Poda de 01 na Rua A - Centro\nSupressão de 01 na Rua B - Aldeota", m.NAO_IDENTIFICADO),
        ("", m.NAO_IDENTIFICADO),
    ],
)  # fmt: skip
def test_bairro_ambiguo_ou_nao_identificado(fortaleza, descricao, esperado):
    assert _bairro(fortaleza, descricao) == esperado


# --- Importação ------------------------------------------------------------------


def test_importa_janeiro_real_sem_perder_nenhuma_arvore(fortaleza):
    saida = _importar(JAN)
    linhas = IndicadorTerritorialExterno.objects.filter(indicador__startswith="manejo_urbfor_")
    por_acao = {a: 0 for a in m.ACOES}
    for i in linhas:
        acao, ano, mes, _sem = m.interpretar_indicador(i.indicador)
        assert (ano, mes) == (2023, 1)
        por_acao[acao] += i.numerador
    # Bairros mais o "sem bairro identificado" somam o total da planilha, a árvore.
    assert por_acao == {"poda": 1032, "supressao": 82, "recolhimento": 119}
    assert (
        "01/2023: 174 serviço(s), 1233 árvore(s) (poda 1032, supressão 82, recolhimento 119)."
        in saida
    )
    assert "difere da linha TOTAL" not in saida
    assert "Com bairro identificado:" in saida and "Sem bairro identificado:" in saida
    # Os serviços de janeiro caem em bairros reais da SER 1 (Vila Velha, Barra do Ceará...).
    vila_velha = fortaleza["bairros"]["Vila Velha"]
    assert linhas.filter(territorio=vila_velha, indicador="manejo_urbfor_poda_202301").exists()


def test_grava_a_proveniencia_completa_e_nao_geocodifica(fortaleza):
    _importar(JAN)
    i = IndicadorTerritorialExterno.objects.get(
        territorio=fortaleza["bairros"]["Vila Velha"], indicador="manejo_urbfor_poda_202301"
    )
    assert i.fonte.startswith("URBFOR")
    assert i.fonte_url == "https://dados.fortaleza.ce.gov.br/dataset/podas_recolhimento_supressao"
    assert i.licenca == "não declarada (DP-10)"
    assert i.data_referencia == date(2023, 1, 31)
    assert i.unidade == "árvores" and i.denominador is None
    assert "sem coordenadas" in i.metodo and "não entram no inventário" in i.metodo
    assert i.ingerido_em is not None and i.definicao
    # Só indicadores por território: nada de árvore, ocorrência ou ponto novo.
    assert not Arvore.objects.exists() and not Ocorrencia.objects.exists()


def test_o_que_nao_tem_bairro_vai_para_o_municipio_sem_perda(fortaleza):
    _importar(AGO)  # "Praia do Futuro" é ambíguo (I e II)
    sem = IndicadorTerritorialExterno.objects.get(indicador="manejo_urbfor_sem_bairro_poda_202308")
    assert sem.territorio == fortaleza["municipio"] and sem.numerador == 27 + 41
    assert not IndicadorTerritorialExterno.objects.filter(territorio__tipo="bairro").exists()


def test_so_grava_o_que_tem_registro(fortaleza):
    _importar(JUN)
    ids = set(IndicadorTerritorialExterno.objects.values_list("indicador", flat=True))
    assert "manejo_urbfor_poda_202306" in ids
    assert not any(i.endswith("_202301") for i in ids)
    assert all(i.numerador > 0 for i in IndicadorTerritorialExterno.objects.all())


def test_reimportar_e_idempotente_e_substitui_o_mes(fortaleza):
    _importar(JAN, MAI)
    primeiro = sorted(IndicadorTerritorialExterno.objects.values_list("indicador", "numerador"))
    _importar(JAN, MAI)
    assert sorted(IndicadorTerritorialExterno.objects.values_list("indicador", "numerador")) == (
        primeiro
    )
    # Reimportar um mês com outro arquivo troca o mês; os demais ficam.
    IndicadorTerritorialExterno.objects.filter(indicador="manejo_urbfor_poda_202301").update(
        numerador=999
    )
    _importar(JAN)
    assert not IndicadorTerritorialExterno.objects.filter(numerador=999).exists()
    assert IndicadorTerritorialExterno.objects.filter(indicador__endswith="_202305").exists()


def test_data_de_outro_mes_e_regional_divergente_no_relatorio(fortaleza):
    saida = _importar(JUN)
    assert "1 linha(s) com data de outro mês; vale o mês do arquivo" in saida
    saida = _importar(MAI)
    # "Rua 107, Mondubim" (SER 10) é do bairro Mondubim, da SER 10; Bela Vista (SER 11) idem.
    assert "cuja regional difere" not in saida
    Territorio.objects.filter(nome="Mondubim").update(pai=fortaleza["regionais"][3])
    assert "árvore(s) de serviços cuja regional difere da do bairro" in _importar(MAI)


def test_exige_municipio_e_bairros_cadastrados(db):
    with pytest.raises(CommandError, match="importar_limites_fortaleza"):
        _importar(JAN)
    assert not IndicadorTerritorialExterno.objects.exists()


def test_erros_claros_de_arquivo(fortaleza, tmp_path):
    ruim = tmp_path / "ruim.csv"
    ruim.write_text("a;b\n1;2\n")
    with pytest.raises(CommandError, match="Cabeçalho"):
        _importar(ruim)
    with pytest.raises(CommandError, match="Não foi possível ler"):
        _importar(tmp_path / "nao_existe.csv")
    with pytest.raises(CommandError, match="Nenhuma planilha de 2024"):
        _importar(JAN, ano=2024)


# --- Download pelo CKAN -----------------------------------------------------------


@responses.activate
def test_baixa_os_csvs_pela_api_do_ckan(fortaleza):
    base = "https://dados.fortaleza.ce.gov.br"
    responses.get(
        f"{m.API_CKAN}?id=podas_recolhimento_supressao",
        json={
            "result": {
                "resources": [
                    {"name": "janeiro 2023", "format": "CSV", "url": f"{base}/jan2023.csv"},
                    {"name": "ficha", "format": "PDF", "url": f"{base}/ficha.pdf"},
                ]
            }
        },
    )
    responses.get(f"{base}/jan2023.csv", body=JAN.read_bytes())
    saida = io.StringIO()
    call_command("importar_manejo_urbfor", stdout=saida)
    assert [c.request.url.split("?")[0] for c in responses.calls] == [
        m.API_CKAN,
        f"{base}/jan2023.csv",
    ]
    assert IndicadorTerritorialExterno.objects.filter(indicador="manejo_urbfor_poda_202301")


@responses.activate
def test_falha_do_ckan_nao_grava_nada(fortaleza):
    responses.get(f"{m.API_CKAN}?id=podas_recolhimento_supressao", status=503)
    with pytest.raises(CommandError, match="Não foi possível obter os CSVs"):
        call_command("importar_manejo_urbfor")
    assert not IndicadorTerritorialExterno.objects.exists()


# --- Análise "Manejo registrado pela URBFOR (2023)" -------------------------------


def _analise(cliente, usuario):
    resposta = cliente.como(usuario).get(URL_ANALISE, ANALISE)
    assert resposta.status_code == 200
    return resposta.json()


def _gestor(fortaleza):
    return com_escopo(criar_usuario("gm@itree.teste", ["gestor"]), fortaleza["municipio"])


def test_analise_lista_bairros_com_detalhe_fonte_e_ressalvas(cliente, fortaleza):
    _importar(JAN, MAI, JUN, MAR, NOV, AGO)
    corpo = _analise(cliente, _gestor(fortaleza))
    assert corpo["titulo"] == "Manejo registrado pela URBFOR (2023)"
    assert corpo["por_bairro"] is True and corpo["base_rotulo"] == "árvores"
    por_nome = {linha["rotulo"]: linha for linha in corpo["linhas"]}
    # Bairro: soma dos meses, com as três ações discriminadas; sem registro não aparece.
    aldeota = por_nome["Aldeota"]
    esperado = sum(
        i.numerador
        for i in IndicadorTerritorialExterno.objects.filter(
            territorio__nome="Aldeota", indicador__startswith="manejo_urbfor_"
        )
    )
    assert aldeota["valor"] == esperado and esperado > 0
    assert aldeota["detalhe"].startswith("Poda ") and " · Supressão " in aldeota["detalhe"]
    com_registro = set(
        IndicadorTerritorialExterno.objects.filter(territorio__tipo="bairro").values_list(
            "territorio__nome", flat=True
        )
    )
    assert set(por_nome) == com_registro | {"Sem bairro identificado"}
    assert "Meireles" in por_nome and len(com_registro) < 121  # bairro sem registro não aparece
    # O que não teve bairro reconhecido aparece à parte, sem sumir.
    sem = por_nome["Sem bairro identificado"]
    assert sem["territorio_id"] is None and sem["valor"] >= 27 + 41
    assert corpo["linhas"][-1] is sem
    valores = [linha["valor"] for linha in corpo["linhas"][:-1]]
    assert valores == sorted(valores, reverse=True)
    assert corpo["total"] == sum(linha["valor"] for linha in corpo["linhas"])
    # Fonte e ressalvas à vista; nenhum código interno chega à tela.
    assert "URBFOR" in corpo["fonte"] and "dados.fortaleza.ce.gov.br" in corpo["fonte"]
    assert "Licença: não declarada (em definição pela prefeitura)" in corpo["fonte"]
    assert "DP-10" not in json.dumps(corpo, ensure_ascii=False)
    for ressalva in ("sem coordenadas", "sem setembro", "não é o mesmo que zero", "inventário"):
        assert ressalva in corpo["definicao"]


def test_analise_so_tem_os_bairros_do_escopo_e_o_sem_bairro_so_no_escopo_municipal(
    cliente, fortaleza
):
    _importar(JAN, MAI, JUN)
    aldeota = fortaleza["bairros"]["Aldeota"]
    x, y = aldeota.geom.centroid.coords
    curto = com_escopo(
        criar_usuario("curto@itree.teste", ["gestor"]),
        criar_territorio("Quadra", geom=quadrado(x - 0.001, y - 0.001, 0.002)),
    )
    corpo = _analise(cliente, curto)
    assert [linha["rotulo"] for linha in corpo["linhas"]] == ["Aldeota"]
    completo = _analise(cliente, _gestor(fortaleza))
    assert "Sem bairro identificado" in {linha["rotulo"] for linha in completo["linhas"]}
    sem_escopo = criar_usuario("sem@itree.teste", ["gestor"])
    assert _analise(cliente, sem_escopo)["linhas"] == []


def test_analise_sem_dados_importados_vem_vazia(cliente, fortaleza):
    assert _analise(cliente, _gestor(fortaleza))["linhas"] == []


def test_analise_exige_permissao_e_esta_no_catalogo(cliente, fortaleza):
    ids = {
        a["id"] for a in cliente.como(_gestor(fortaleza)).get("/api/v1/relatorios/catalogo").json()["analises"]
    }  # fmt: skip
    assert "manejo_urbfor_por_bairro" in ids
    sem_papel = com_escopo(criar_usuario("nada@itree.teste", []), fortaleza["municipio"])
    assert cliente.como(sem_papel).get(URL_ANALISE, ANALISE).status_code == 403


def test_manejo_nao_vaza_para_o_contexto_externo_da_visao_geral(cliente, fortaleza):
    _importar(JAN)
    corpo = cliente.como(_gestor(fortaleza)).get("/api/v1/indicadores/painel").json()
    assert corpo["contexto_externo"] == []
