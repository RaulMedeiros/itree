"""Doação de mudas e plantio da URBFOR (F-04, planilhas de 2022).

As planilhas de teste reproduzem, em XLSX gerado aqui, o formato real do dataset
``doacao-mudas-pf`` do CKAN de Fortaleza (conferido em 2026-11-15): título do mês, fichas com
REQUERENTE/DATA/ENDEREÇO (LOCAL no plantio), cabeçalho repetido, espécie na coluna E e quantidade
na F, categoria nas colunas A a D, linha TOTAL, "TOTAL DE MUDAS DOADAS" do mês, tabelas soltas com
"#REF!" nas colunas H a M, total sem rótulo e linhas vazias. Nenhum teste usa rede.
"""

import io
import json
from datetime import date, datetime

import pytest
import responses
from django.core.management import call_command
from django.core.management.base import CommandError
from django.forms.models import model_to_dict
from openpyxl import Workbook

from itree.indicadores import doacao_plantio as d
from itree.indicadores import fichas_urbfor
from itree.indicadores.models import DoacaoMudas, MotivoSemBairro, RegistroPlantio
from itree.inventario.leitura_arquivos import ErroArquivo, ler_abas_xlsx
from itree.inventario.models import Arvore, Especie
from itree.territorio.models import Territorio

from .conftest import com_escopo, criar_territorio, criar_usuario, quadrado

pytestmark = pytest.mark.django_db

CABECALHO = ["ORNAMENTAL", "NATIVA/FRUTÍFERA", "PALMEIRA", "MEDICINAL", "ESPÉCIE", "QUANTIDADE"]
URL_ANALISE = "/api/v1/relatorios/analise"
REQUERENTE_PESSOAL = "Maria Aparecida Souza Lima"
ENDERECO_PESSOAL = "Rua das Flores, 99, apto 3"


def linha_especie(nome, quantidade, coluna=None):
    """Linha de espécie: o nome na coluna E e, se ``coluna`` (0 a 3), repetido na da categoria."""
    linha = [None, None, None, None, nome, quantidade]
    if coluna is not None:
        linha[coluna] = nome
    return linha


def ficha_doacao(data, itens, *, total="auto", requerente=REQUERENTE_PESSOAL, endereco=None):
    linhas = [
        [None, None, None, None, "REQUERENTE:", requerente],
        [None, None, None, None, "DATA:", data],
        [None, None, None, None, "ENDEREÇO:", endereco],
        CABECALHO,
        *itens,
        [None, None, None, None, None, None],
    ]
    soma = sum(i[5] for i in itens if isinstance(i[5], int))
    if total == "auto":
        linhas.append([None, None, None, None, "TOTAL", soma])
    elif total == "sem_rotulo":
        linhas.append([None, None, None, None, None, soma])
        linhas.append([None, None, None, None, "TOTAL", soma])
    return linhas


def aba_de(nome, linhas, wb):
    ws = wb.create_sheet(nome)
    for linha in linhas:
        ws.append(linha)


def planilha(linhas, auxiliares=None, aba="Doação-PF") -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    aba_de(aba, linhas, wb)
    nomes = {
        "Ornamentais": [],
        "Nativas e Frutíferas": [],
        "Palmeiras": [],
        "Medicinal": [],
    }
    nomes.update(auxiliares or {})
    for nome, especies in nomes.items():
        aba_de(nome, [[e] for e in especies], wb)
    saida = io.BytesIO()
    wb.save(saida)
    return saida.getvalue()


def doacao_basica(requerente=REQUERENTE_PESSOAL) -> bytes:
    linhas = [
        [*CABECALHO, None, "ORN", "NAT/FRU", "PAL", "MED", "TOTAL"],
        ["JANEIRO - 2022"],
        *ficha_doacao(
            datetime(2022, 1, 4),
            [
                linha_especie("Ipê", 4, 1),
                linha_especie("Mini lacre", 10),
                linha_especie("Cróton", 6),
            ],
            requerente=requerente,
            endereco=ENDERECO_PESSOAL,
        ),
        ["RETORNO FÉRIAS"],
        # Tabela solta nas colunas H a M, com "#REF!", ao lado das espécies: ignorada.
        [None] * 7 + ["#REF!", 179, "#REF!", None, "#REF!"],
        [None, None, None, None, "TOTAL DE MUDAS DOADAS", 99],
        ["Junho- 2022"],
        *ficha_doacao(
            None,  # ficha sem data: vale o mês do título
            [linha_especie("Palmeira havaí", 3, 2), linha_especie("Capim santo", 5)],
            total="sem_rotulo",
            requerente=requerente,
        ),
        *ficha_doacao(datetime(2022, 6, 7), [], total=None, requerente=requerente),  # sem espécie
    ]
    return planilha(
        linhas, auxiliares={"Ornamentais": ["Cróton", "Mini lacre"], "Medicinal": ["Capim santo"]}
    )


# --- Leitura das fichas ------------------------------------------------------------------------


def test_le_as_fichas_com_total_categoria_e_a_lista_auxiliar():
    abas = ler_abas_xlsx(doacao_basica())
    leitura = fichas_urbfor.ler_planilha(abas)
    primeira, segunda = leitura.fichas[0], leitura.fichas[1]
    assert (primeira.ano, primeira.mes, primeira.data) == (2022, 1, date(2022, 1, 4))
    assert [(i.especie, i.quantidade, i.categoria, i.categoria_via) for i in primeira.itens] == [
        ("Ipê", 4, "nativa_frutifera", "planilha"),
        ("Mini lacre", 10, "ornamental", "lista_auxiliar"),
        ("Cróton", 6, "ornamental", "lista_auxiliar"),
    ]
    assert primeira.total == primeira.total_declarado == 20
    assert segunda.data is None and (segunda.ano, segunda.mes) == (2022, 6)
    assert segunda.total_declarado == 8  # o total sem rótulo e o TOTAL repetido
    assert segunda.itens[0].categoria == "palmeira"
    assert not leitura.nao_entendidas


def test_total_sem_especie_vira_especie_nao_informada():
    linhas = [
        ["MARÇO - 2022"],
        [None, None, None, None, "REQUERENTE:", "SEUMA"],
        [None, None, None, None, "DATA:", datetime(2022, 3, 1)],
        [None, None, None, None, None, 70],
        [None, None, None, None, "TOTAL", 70],
    ]
    leitura = fichas_urbfor.ler_planilha(ler_abas_xlsx(planilha(linhas)))
    assert [(i.especie, i.quantidade) for i in leitura.fichas[0].itens] == [
        (fichas_urbfor.ESPECIE_NAO_INFORMADA, 70)
    ]


def test_linha_de_especie_com_quantidade_invalida_e_relatada_e_nao_somada():
    linhas = [
        ["MARÇO - 2022"],
        *ficha_doacao(
            datetime(2022, 3, 1),
            [linha_especie("Ipê", "muitas"), linha_especie("Ipê", 2)],
            total=None,
        ),
        [None, None, None, None, "TOTAL", 2],
    ]
    leitura = fichas_urbfor.ler_planilha(ler_abas_xlsx(planilha(linhas)))
    assert leitura.fichas[0].total == 2
    assert leitura.nao_entendidas == [(6, "quantidade ausente ou inválida", "Ipê")]


def test_data_com_periodo_vira_inicio_e_fim():
    linhas = [
        ["FEVEREIRO - 2022"],
        [None, None, None, None, "DATA:", "02/02/2022 - 28/02/2022"],
        [None, None, None, None, "ENDEREÇO:", None],
        [None, None, None, None, "LOCAL:", "Lagoa da Viúva"],
        linha_especie("Ipê", 2),
        [None, None, None, None, "TOTAL", 2],
    ]
    ficha = fichas_urbfor.ler_planilha(ler_abas_xlsx(planilha(linhas, aba="Plantio"))).fichas[0]
    assert (ficha.data, ficha.data_fim) == (date(2022, 2, 2), date(2022, 2, 28))


def test_xlsx_que_nao_e_planilha_e_recusado_com_mensagem():
    with pytest.raises(ErroArquivo, match="ZIP|planilha"):
        ler_abas_xlsx(b"nao e uma planilha")


def test_xlsx_respeita_o_limite_de_tamanho(settings):
    settings.IMPORTACAO_TAMANHO_MAXIMO_MB = 0
    with pytest.raises(ErroArquivo, match="limite"):
        ler_abas_xlsx(doacao_basica())


# --- Doação -----------------------------------------------------------------------------------


def _campos_de_texto(modelo) -> str:
    """Tudo o que o banco guarda de cada linha, como um texto só."""
    return json.dumps(
        [model_to_dict(o) for o in modelo.objects.all()], default=str, ensure_ascii=False
    )


def test_importa_a_doacao_por_especie_e_categoria():
    r = d.importar_doacao({"pf": doacao_basica()})["pf"]
    assert (r.fichas, r.linhas, r.mudas, r.fichas_sem_especie) == (2, 5, 28, 1)
    assert r.total_declarado == 28 and r.fichas_com_total_diferente == 0
    ipe = DoacaoMudas.objects.get(especie_texto="Ipê")
    assert (ipe.beneficiario, ipe.ano, ipe.mes, ipe.data, ipe.quantidade) == (
        "pf",
        2022,
        1,
        date(2022, 1, 4),
        4,
    )
    assert (ipe.categoria, ipe.categoria_via) == ("nativa_frutifera", "planilha")
    assert DoacaoMudas.objects.get(especie_texto="Capim santo").categoria == "medicinal"
    sem_data = DoacaoMudas.objects.get(especie_texto="Palmeira havaí")
    assert sem_data.data is None and sem_data.mes == 6
    assert (ipe.fonte, ipe.licenca) == (d.FONTE, d.LICENCA)
    assert ipe.data_referencia == d.DATA_REFERENCIA and ipe.ingerido_em


def test_doacao_nao_grava_requerente_nem_endereco():
    d.importar_doacao({"pf": doacao_basica(), "pj": doacao_basica("Empresa Verde Ltda")})
    assert DoacaoMudas.objects.count() == 10
    texto = _campos_de_texto(DoacaoMudas)
    for pessoal in (REQUERENTE_PESSOAL, "Empresa Verde", ENDERECO_PESSOAL, "Rua das Flores"):
        assert pessoal not in texto
    campos = {f.name for f in DoacaoMudas._meta.get_fields()}
    assert not campos & {"requerente", "endereco", "nome", "cpf", "telefone", "email"}


def test_doacao_casa_a_especie_do_catalogo_pelo_nome_popular_ou_cientifico():
    ipe = Especie.objects.create(nome_cientifico="Handroanthus albus", nomes_comuns=["Ipê"])
    Especie.objects.create(nome_cientifico="Cordia a", nomes_comuns=["Cróton"])
    Especie.objects.create(nome_cientifico="Cordia b", nomes_comuns=["Cróton"])  # ambíguo
    r = d.importar_doacao({"pf": doacao_basica()})["pf"]
    assert DoacaoMudas.objects.get(especie_texto="Ipê").especie == ipe
    assert DoacaoMudas.objects.get(especie_texto="Ipê").especie_via == "nome_popular"
    assert DoacaoMudas.objects.get(especie_texto="Cróton").especie is None
    assert r.linhas_no_catalogo == 1


def test_reimportar_a_doacao_troca_as_linhas_sem_duplicar():
    d.importar_doacao({"pf": doacao_basica()})
    d.importar_doacao({"pf": doacao_basica()})
    assert DoacaoMudas.objects.count() == 5
    d.importar_doacao({"pj": doacao_basica()})  # outro tipo não apaga o anterior
    assert DoacaoMudas.objects.filter(beneficiario="pf").count() == 5
    assert DoacaoMudas.objects.filter(beneficiario="pj").count() == 5


def test_planilha_de_doacao_sem_especies_nao_grava_nada():
    vazia = planilha([["JANEIRO - 2022"], *ficha_doacao(datetime(2022, 1, 4), [], total=None)])
    with pytest.raises(d.PlanilhaInvalida, match="não trouxe ficha com espécie"):
        d.importar_doacao({"pf": vazia})
    assert not DoacaoMudas.objects.exists()


def test_comando_importa_pelos_arquivos_locais_e_relata(tmp_path):
    pf = tmp_path / "pf.xlsx"
    pf.write_bytes(doacao_basica())
    saida = io.StringIO()
    call_command("importar_doacao_mudas", "--arquivo-pf", str(pf), stdout=saida)
    texto = saida.getvalue()
    assert "Doação a pessoa física: 2 ficha(s), 5 linha(s) de espécie, 28 muda(s)." in texto
    assert "1 ficha(s) sem espécie" in texto
    assert DoacaoMudas.objects.count() == 5


def test_comando_com_arquivo_invalido_ou_ausente_da_erro_claro(tmp_path):
    ruim = tmp_path / "ruim.xlsx"
    ruim.write_bytes(b"lixo")
    with pytest.raises(CommandError):
        call_command("importar_doacao_mudas", "--arquivo-pf", str(ruim), stdout=io.StringIO())
    with pytest.raises(CommandError, match="Não foi possível ler o arquivo"):
        call_command("importar_doacao_mudas", "--arquivo-pf", str(tmp_path / "x.xlsx"))
    assert not DoacaoMudas.objects.exists()


@responses.activate
def test_comando_baixa_as_planilhas_pelo_ckan():
    base = "https://dados.fortaleza.ce.gov.br"
    responses.get(
        f"{d.API_CKAN}?id={d.DATASET}",
        json={
            "result": {
                "resources": [
                    {"id": d.RECURSOS["pf"], "format": "XLSX", "url": f"{base}/pf.xlsx"},
                    {"id": d.RECURSOS["pj"], "format": "XLSX", "url": f"{base}/pj.xlsx"},
                    {"id": d.RECURSOS["plantio"], "format": "XLSX", "url": f"{base}/pl.xlsx"},
                ]
            }
        },
    )
    responses.get(f"{base}/pf.xlsx", body=doacao_basica())
    responses.get(f"{base}/pj.xlsx", body=doacao_basica())
    call_command("importar_doacao_mudas", stdout=io.StringIO())
    assert DoacaoMudas.objects.count() == 10
    assert not any("pl.xlsx" in c.request.url for c in responses.calls)


@responses.activate
def test_falha_do_ckan_na_doacao_nao_grava_nada(monkeypatch):
    monkeypatch.setattr(
        "itree.indicadores.management.commands.importar_manejo_urbfor.time.sleep", lambda s: None
    )
    responses.get(f"{d.API_CKAN}?id={d.DATASET}", status=503)
    with pytest.raises(CommandError, match="Não foi possível obter as planilhas"):
        call_command("importar_doacao_mudas")
    assert not DoacaoMudas.objects.exists()


# --- Plantio ----------------------------------------------------------------------------------


@pytest.fixture
def cidade(db):
    municipio = criar_territorio("Fortaleza", tipo="municipio", geom=quadrado(-38.7, -3.95, 0.4))
    bairros = {
        nome: criar_territorio(nome, geom=quadrado(-38.6 + i * 0.03, -3.8, 0.02))
        for i, nome in enumerate(["Floresta", "Aldeota", "Granja Portugal", "Praia do Futuro I"])
    }
    for b in bairros.values():
        Territorio.objects.filter(pk=b.pk).update(pai=municipio)
    return {"municipio": municipio, "bairros": bairros}


def ficha_plantio(data, endereco, local, itens, total="auto"):
    soma = sum(i[5] for i in itens if isinstance(i[5], int))
    return [
        [None, None, None, None, "DATA:", data],
        [None, None, None, None, "ENDEREÇO:", endereco],
        [None, None, None, None, "LOCAL:", local],
        CABECALHO,
        *itens,
        [None, None, None, None, "TOTAL", soma if total == "auto" else total],
    ]


def plantio_basico() -> bytes:
    linhas = [
        ["JANEIRO - 2022"],
        # Mesma forma da planilha real: a data de dezembro de 2021 sob o título de janeiro de 2022.
        *ficha_plantio(
            datetime(2021, 12, 2),
            "Rua Cons. Lafayete, 205 - Bairro Floresta",
            "Escola Fco Silva",
            [linha_especie("Mini lacre", 560, 0), linha_especie("Ipê", 5, 1)],
        ),
        *ficha_plantio(
            datetime(2022, 1, 5),
            "Rua Atilano Moura - Aldetoa",  # grafia da URBFOR: alias de Aldeota
            None,
            [linha_especie("Cróton", 70)],
        ),
        *ficha_plantio(datetime(2022, 1, 14), "Av. Luciano Carneiro", None, [linha_especie("Vinca", 50)]),
        *ficha_plantio(datetime(2022, 1, 15), "Rua Cons. Lafayete, 205 ", None, [linha_especie("Ipê", 3)]),
        *ficha_plantio(datetime(2022, 1, 16), None, "Parque Guararapes", [linha_especie("Ipê", 8)]),
        *ficha_plantio(datetime(2022, 1, 17), "Rua X - Praia do Futuro", None, [linha_especie("Ipê", 4)]),
        *ficha_plantio(datetime(2022, 1, 18), "Rua Y - Bairro Inventado", None, [linha_especie("Ipê", 6)]),
        ["FEVEREIRO - 2022"],
        *ficha_plantio("02/02/2022 - 28/02/2022", "Rua Andreas Soares", "Lagoa da Viúva", [linha_especie("Ipê", 9)], total=None),
        ["Setembro- 2022"],
        *ficha_plantio(None, None, None, [], total=0),  # ficha vazia, como a de setembro real
    ]  # fmt: skip
    return planilha(linhas, aba="Plantio")


def test_importa_o_plantio_e_resolve_o_bairro_pelo_texto_do_endereco(cidade):
    r = d.importar_plantio(plantio_basico())
    assert (r.fichas, r.mudas, r.fichas_sem_especie) == (8, 565 + 70 + 50 + 3 + 8 + 4 + 6 + 9, 1)
    por_endereco = {p.endereco: p for p in RegistroPlantio.objects.all()}
    floresta = por_endereco["Rua Cons. Lafayete, 205 - Bairro Floresta"]
    assert floresta.bairro.nome == "Floresta" and floresta.motivo_sem_bairro == ""
    assert floresta.data == date(2021, 12, 2) and (floresta.ano, floresta.mes) == (2022, 1)
    assert floresta.local == "Escola Fco Silva" and floresta.total_mudas == 565
    assert floresta.especies == [
        {"especie": "Mini lacre", "categoria": "ornamental", "quantidade": 560},
        {"especie": "Ipê", "categoria": "nativa_frutifera", "quantidade": 5},
    ]
    assert (floresta.fonte, floresta.licenca) == (d.FONTE, d.LICENCA)
    assert por_endereco["Rua Atilano Moura - Aldetoa"].bairro.nome == "Aldeota"  # alias
    assert r.com_bairro == 2 and r.mudas_com_bairro == 565 + 70


@pytest.mark.parametrize(
    ("endereco", "motivo"),
    [
        ("Av. Luciano Carneiro", MotivoSemBairro.SEM_TEXTO),
        ("Rua Cons. Lafayete, 205 ", MotivoSemBairro.SEM_TEXTO),
        ("Rua X - Praia do Futuro", MotivoSemBairro.AMBIGUO),  # serve a I e a II
        ("Rua Y - Bairro Inventado", MotivoSemBairro.NAO_RECONHECIDO),
        ("", MotivoSemBairro.SEM_ENDERECO),
    ],
)
def test_plantio_sem_bairro_no_texto_fica_vazio_com_o_motivo(cidade, endereco, motivo):
    d.importar_plantio(plantio_basico())
    if endereco:
        registro = RegistroPlantio.objects.get(endereco=endereco.strip(), local="")
    else:
        registro = RegistroPlantio.objects.get(local="Parque Guararapes")
    assert registro.bairro is None and registro.motivo_sem_bairro == motivo


def test_plantio_nao_geocodifica_e_nao_cria_arvore(cidade):
    d.importar_plantio(plantio_basico())
    assert not Arvore.objects.exists()
    campos = {f.name for f in RegistroPlantio._meta.get_fields()}
    assert not campos & {"geom", "latitude", "longitude", "arvore"}


def test_plantio_com_periodo_e_total_declarado_ausente(cidade):
    d.importar_plantio(plantio_basico())
    periodo = RegistroPlantio.objects.get(local="Lagoa da Viúva")
    assert (periodo.data, periodo.data_fim) == (date(2022, 2, 2), date(2022, 2, 28))
    assert periodo.total_declarado is None and periodo.total_mudas == 9


def test_plantio_exige_os_bairros_cadastrados(db):
    with pytest.raises(d.PlanilhaInvalida, match="importar_limites_fortaleza"):
        d.importar_plantio(plantio_basico())
    assert not RegistroPlantio.objects.exists()


def test_reimportar_o_plantio_nao_duplica(cidade):
    d.importar_plantio(plantio_basico())
    d.importar_plantio(plantio_basico())
    assert RegistroPlantio.objects.count() == 8


def test_comando_do_plantio_relata_o_bairro_e_a_parcela_sem_bairro(cidade, tmp_path):
    arquivo = tmp_path / "plantio.xlsx"
    arquivo.write_bytes(plantio_basico())
    saida = io.StringIO()
    call_command("importar_plantio_urbfor", "--arquivo", str(arquivo), stdout=saida)
    texto = saida.getvalue()
    assert "8 plantio(s) lido(s)" in texto
    assert "Com bairro identificado: 2 (25,0%)" in texto
    assert "Sem endereço (só o local): 1" in texto
    assert "Endereço sem bairro no texto: 3" in texto
    assert "Nome que serve a dois bairros: 1" in texto
    assert "Bairro do texto não reconhecido: 1" in texto
    assert "Inventado: 6 muda(s)" in texto


# --- Análises ---------------------------------------------------------------------------------


def _analise(cliente, usuario, chave):
    resposta = cliente.como(usuario).get(URL_ANALISE, {"analise": chave})
    assert resposta.status_code == 200, resposta.content
    return resposta.json()


def _municipal(cidade):
    from itree.contas.models import Usuario

    existente = Usuario.objects.filter(email="gm@itree.teste").first()
    return existente or com_escopo(criar_usuario("gm@itree.teste", ["gestor"]), cidade["municipio"])


def test_analise_de_doacao_por_especie_tem_top_15_o_resto_em_outras_e_fonte(cliente, cidade):
    itens = [linha_especie(f"Espécie {i:02d}", 100 - i) for i in range(17)]
    itens += [
        linha_especie("espécie 00", 1),
        linha_especie("Mini lacre", 5),
        linha_especie("Minilacre", 5),
    ]
    d.importar_doacao({"pf": planilha(["JANEIRO - 2022"] and [["JANEIRO - 2022"], *ficha_doacao(datetime(2022, 1, 4), itens)])})  # fmt: skip
    corpo = _analise(cliente, _municipal(cidade), "mudas_doadas_por_especie")
    linhas = corpo["linhas"]
    assert len(linhas) == 16 and linhas[-1]["rotulo"] == "Outras (3 espécies)"
    assert linhas[0] == {
        "rotulo": "Espécie 00",
        "valor": 101,  # "espécie 00" soma com "Espécie 00"
        "detalhe": "pessoa física 101",
    }
    # Espécies 15 (85) e 16 (84) e "Mini lacre" (5 + 5 de "Minilacre"): 179 mudas.
    assert linhas[-1]["valor"] == 85 + 84 + 10
    assert corpo["total"] == sum(linha["valor"] for linha in linhas)
    assert "URBFOR" in corpo["fonte"] and "2022" in corpo["fonte"] and "cc-by-sa" in corpo["fonte"]
    assert "sem coordenadas" not in corpo["definicao"] and "não vai ao mapa" in corpo["definicao"]
    assert "DP-" not in json.dumps(corpo, ensure_ascii=False)


def test_analise_de_doacao_por_categoria_declara_o_que_nao_tem_categoria(cliente, cidade):
    d.importar_doacao({"pf": doacao_basica(), "pj": doacao_basica()})
    corpo = _analise(cliente, _municipal(cidade), "mudas_doadas_por_categoria")
    por = {linha["rotulo"]: linha["valor"] for linha in corpo["linhas"]}
    assert por == {
        "Ornamental": 32,  # Mini lacre 10 e Cróton 6, duas vezes (lista auxiliar)
        "Nativa ou frutífera": 8,
        "Palmeira": 6,
        "Medicinal": 10,
    }
    assert corpo["total"] == 56


def test_analise_de_doacao_exige_escopo_municipal_e_some_do_catalogo(cliente, cidade):
    d.importar_doacao({"pf": doacao_basica()})
    restrito = com_escopo(criar_usuario("b@itree.teste", ["gestor"]), cidade["bairros"]["Floresta"])
    for chave in ("mudas_doadas_por_especie", "mudas_doadas_por_categoria"):
        assert cliente.como(restrito).get(URL_ANALISE, {"analise": chave}).status_code == 403
    ids = {a["id"] for a in cliente.como(restrito).get("/api/v1/relatorios/catalogo").json()["analises"]}  # fmt: skip
    assert "plantios_por_bairro" in ids and "mudas_doadas_por_especie" not in ids
    ids = {a["id"] for a in cliente.como(_municipal(cidade)).get("/api/v1/relatorios/catalogo").json()["analises"]}  # fmt: skip
    assert {"mudas_doadas_por_especie", "mudas_doadas_por_categoria"} <= ids
    sem_papel = com_escopo(criar_usuario("n@itree.teste", []), cidade["municipio"])
    for chave in ("mudas_doadas_por_especie", "plantios_por_bairro"):
        assert cliente.como(sem_papel).get(URL_ANALISE, {"analise": chave}).status_code == 403


def test_analise_de_plantios_por_bairro_declara_a_parcela_sem_bairro(cliente, cidade):
    d.importar_plantio(plantio_basico())
    corpo = _analise(cliente, _municipal(cidade), "plantios_por_bairro")
    assert [(linha["rotulo"], linha["valor"]) for linha in corpo["linhas"]] == [
        ("Floresta", 565),
        ("Aldeota", 70),
        ("Sem bairro identificado", 50 + 3 + 8 + 4 + 6 + 9),
    ]
    sem = corpo["linhas"][-1]
    assert "6 plantio(s)" in sem["detalhe"] and "Endereço sem bairro no texto" in sem["detalhe"]
    assert corpo["por_bairro"] is True and "sem coordenadas" in corpo["definicao"]
    assert "não árvores do inventário" in corpo["definicao"] or "inventário" in corpo["definicao"]


def test_analise_de_plantios_so_mostra_os_bairros_do_escopo_e_o_sem_bairro_so_ao_municipal(
    cliente, cidade
):
    d.importar_plantio(plantio_basico())
    restrito = com_escopo(criar_usuario("b@itree.teste", ["gestor"]), cidade["bairros"]["Aldeota"])
    corpo = _analise(cliente, restrito, "plantios_por_bairro")
    assert [linha["rotulo"] for linha in corpo["linhas"]] == ["Aldeota"]
    sem_escopo = criar_usuario("s@itree.teste", ["gestor"])
    assert _analise(cliente, sem_escopo, "plantios_por_bairro")["linhas"] == []


def test_analises_sem_dados_importados_vem_vazias(cliente, cidade):
    for chave in ("mudas_doadas_por_especie", "mudas_doadas_por_categoria", "plantios_por_bairro"):
        assert _analise(cliente, _municipal(cidade), chave)["linhas"] == []
