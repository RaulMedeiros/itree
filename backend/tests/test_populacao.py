"""População, renda e IDH por bairro: importadores com arquivos pequenos gerados aqui, estimativa
proporcional, descoberta da versão nas listagens, renovação mensal, indicadores e escopo."""

import io
import json
import zipfile
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from itree.indicadores import populacao as pop
from itree.indicadores import populacao_indicadores as pi
from itree.indicadores.models import ExecucaoFonteExterna, IndicadorTerritorialExterno
from itree.inventario.models import Arvore

from .conftest import com_escopo, criar_territorio, criar_usuario, quadrado

pytestmark = pytest.mark.django_db

URL_BASICO = (
    "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/"
    "Agregados_por_Bairro_csv/Agregados_por_bairros_basico_BR_20260520.zip"
)


def _zip(nome: str, texto: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(nome, texto.encode("iso-8859-1"))
    return buf.getvalue()


def basico(linhas) -> bytes:
    cab = '"CD_BAIRRO";"NM_BAIRRO";"CD_MUN";"AREA_KM2";"v0001";"v0002"\r\n'
    corpo = "".join(f'"{c}";"{n}";"{m}";"1,5";"{p}";"{d}"\r\n' for c, n, m, p, d in linhas)
    return _zip("Agregados_por_bairros_basico_BR.csv", cab + corpo)


def municipios(total: int) -> bytes:
    return _zip(
        "Agregados_por_municipios_basico_BR.csv",
        f'"CD_MUN";"NM_MUN";"v0001"\r\n"2304400";"Fortaleza";"{total}"\r\n'
        '"2300101";"Outro";"999"\r\n',
    )


def renda(linhas) -> bytes:
    cab = '"CD_BAIRRO";"NM_BAIRRO";"V06001";"V06002";"V06004"\r\n'
    return _zip(
        "Agregados_por_bairros_renda_responsavel_BR.csv",
        cab + "".join(f'"{c}";"{n}";"{r}";"1";"{v}"\r\n' for c, n, r, v in linhas),
    )


def idh_geojson(registros) -> bytes:
    return json.dumps(
        {
            "features": [
                {
                    "properties": {
                        "nome": n,
                        "idh": i,
                        "idh_educ": 0.9,
                        "idh_longev": 0.8,
                        "idh_renda": 0.5,
                        "ano_ref": 2010,
                    }
                }
                for n, i in registros
            ]
        }
    ).encode()


@pytest.fixture
def cidade(db):
    """Município e dois bairros com código IBGE: A (≈1,2 km²) e B (≈1,2 km²), mais um sem código."""
    m = criar_territorio("Fortaleza", tipo="municipio", geom=quadrado(-38.6, -3.8, 0.2))
    a = criar_territorio("Aldeota", codigo="2304400002", geom=quadrado(-38.56, -3.76, 0.01))
    b = criar_territorio("Centro", codigo="2304400010", geom=quadrado(-38.54, -3.76, 0.01))
    c = criar_territorio("Sem código", codigo="x", geom=quadrado(-38.52, -3.76, 0.01))
    return {"municipio": m, "a": a, "b": b, "c": c}


LINHAS = [
    ("2304400002", "Aldeota", "2304400", 42580, 18714),
    ("2304400010", "Centro", "2304400", 24096, 15827),
    ("2304400999", "Bairro novo", "2304400", 100, 40),  # sem casamento com os bairros cadastrados
    ("1100015001", "Centro", "1100015", 1213, 637),  # outro município: ignorado
]


def get(territorio, indicador):
    return IndicadorTerritorialExterno.objects.get(territorio=territorio, indicador=indicador)


# --- Censo: população por bairro -------------------------------------------------------------


def test_censo_casa_por_codigo_soma_e_versao(cidade):
    r = pop.importar_populacao_censo(
        basico(LINHAS), fonte_url=URL_BASICO, total_municipal=66_676 + 100
    )
    assert r.gravados == 2
    assert r.sem_casamento_no_arquivo == ["Bairro novo"]
    assert r.bairros_sem_dado == ["Sem código"]
    # A soma dos bairros do arquivo (de Fortaleza) é conferida contra o total municipal.
    assert r.total_arquivo == 42580 + 24096 + 100
    assert (r.total_municipal, r.diferenca) == (66_776, 0)
    a = get(cidade["a"], pop.POPULACAO_CENSO)
    assert (a.numerador, a.denominador, int(a.valor)) == (42580, 18714, 42580)
    assert a.versao == "20260520" and a.fonte_url == URL_BASICO
    assert a.data_referencia == date(2022, 7, 31) and a.fonte == "IBGE, Censo Demográfico 2022"
    assert a.licenca and a.ingerido_em
    assert get(cidade["municipio"], pop.CENSO_MUNICIPIO).numerador == 66_776
    assert not IndicadorTerritorialExterno.objects.filter(territorio=cidade["c"]).exists()


def test_censo_informa_diferenca_para_o_total_municipal(cidade):
    r = pop.importar_populacao_censo(basico(LINHAS), total_municipal=66_000)
    assert r.diferenca == 776


def test_densidade_usa_a_area_do_poligono_em_utm(cidade):
    pop.importar_populacao_censo(basico(LINHAS), fonte_url=URL_BASICO)
    d = get(cidade["a"], pop.DENSIDADE)
    area_km2 = d.denominador / 1_000_000
    # 0,01° ≈ 1,1 km por 1,1 km em Fortaleza: ≈ 1,2 km².
    assert 1.1 < area_km2 < 1.3
    assert float(d.valor) == pytest.approx(42580 / area_km2, rel=0.001)
    assert d.unidade == "hab/km²"


def test_censo_e_idempotente_e_o_ano_vem_do_arquivo(cidade):
    url_2032 = URL_BASICO.replace("Censo_Demografico_2022", "Censo_Demografico_2032")
    pop.importar_populacao_censo(basico(LINHAS), fonte_url=URL_BASICO)
    pop.importar_populacao_censo(basico(LINHAS), fonte_url=url_2032)
    assert IndicadorTerritorialExterno.objects.filter(indicador=pop.POPULACAO_CENSO).count() == 2
    a = get(cidade["a"], pop.POPULACAO_CENSO)
    assert a.data_referencia.year == 2032 and "2032" in a.fonte


def test_censo_recusa_arquivo_sem_colunas_ou_sem_fortaleza(cidade):
    with pytest.raises(pop.FonteInvalida, match="Colunas ausentes"):
        pop.importar_populacao_censo(_zip("a.csv", '"CD_BAIRRO";"v0001"\r\n"1";"2"\r\n'))
    with pytest.raises(pop.FonteInvalida, match="Nenhum bairro de Fortaleza"):
        pop.importar_populacao_censo(basico([LINHAS[3]]))


def test_zip_com_csv_grande_demais_e_recusado(cidade, monkeypatch):
    monkeypatch.setattr(pop, "MAX_BYTES_DESCOMPACTADO", 50)
    with pytest.raises(pop.FonteInvalida, match="maior que o limite"):
        pop.importar_populacao_censo(basico(LINHAS))


def test_download_so_de_hosts_permitidos():
    with pytest.raises(pop.FonteInvalida, match="fora da lista"):
        pop.baixar("https://exemplo.com/x.zip")
    with pytest.raises(pop.FonteInvalida, match="fora da lista"):
        pop.baixar("http://ftp.ibge.gov.br/x.zip")


# --- Rendimento -------------------------------------------------------------------------------


def test_renda_do_responsavel_por_bairro(cidade):
    r = pop.importar_renda(
        renda([("2304400002", "Aldeota", 16288, "10572,06"), ("2304400010", "Centro", 9962, "X")]),
        fonte_url=URL_BASICO.replace(
            "basico_BR_20260520.zip", "renda_responsavel_BR_20260508_csv.zip"
        ),
    )
    assert r.gravados == 1  # "X" é sigilo: sem valor, nunca zero
    a = get(cidade["a"], pop.RENDA)
    assert a.valor == Decimal("10572.0600") and a.numerador == 16288 and a.unidade == "R$"
    assert a.versao == "20260508" and "não renda per capita" in a.definicao
    assert not IndicadorTerritorialExterno.objects.filter(
        territorio=cidade["b"], indicador=pop.RENDA
    ).exists()


# --- Estimativa -------------------------------------------------------------------------------


def planilha(populacao=2_582_360, ano=2026, mes="JULHO") -> bytes:
    from openpyxl import Workbook

    livro = Workbook()
    aba = livro.active
    aba.title = "MUNICÍPIOS"
    aba.append(
        [
            f"ESTIMATIVAS DA POPULAÇÃO RESIDENTE NOS MUNICÍPIOS COM DATA DE REFERÊNCIA EM 1º DE {mes} DE {ano}"
        ]
    )
    aba.append(["UF", "COD. UF", "COD. MUNIC", "NOME DO MUNICÍPIO", "POPULAÇÃO ESTIMADA"])
    aba.append(["CE", 23, "00019", "Outra", 1000])
    aba.append(["CE", 23, "04400", "Fortaleza", f"{populacao:,}".replace(",", ".") + "(1)"])
    buf = io.BytesIO()
    livro.save(buf)
    return buf.getvalue()


def test_ler_estimativa_do_municipio():
    e = pop.ler_estimativa(planilha())
    assert (e.populacao, e.ano, e.data_referencia) == (2_582_360, 2026, date(2026, 7, 1))
    with pytest.raises(pop.FonteInvalida, match="XLSX"):
        pop.ler_estimativa(b"nao e planilha")


def test_estimativa_por_bairro_e_proporcional_ao_censo(cidade):
    pop.importar_populacao_censo(basico(LINHAS), total_municipal=66_776)
    r = pop.importar_estimativa(
        planilha(70_000), fonte_url="https://ftp.ibge.gov.br/POP2026_20261029.xlsx"
    )
    assert r.bairros == 2
    municipio = get(cidade["municipio"], pop.ESTIMATIVA_MUNICIPIO)
    assert municipio.numerador == 70_000 and municipio.versao == "20261029"
    a = get(cidade["a"], pop.POPULACAO_ESTIMADA)
    # 42.580 × (70.000 ÷ 66.776)
    assert int(a.valor) == round(42580 * 70_000 / 66_776)
    assert a.denominador == 42580
    # Sempre rotulada como estimativa iTree, com o método e a hipótese.
    assert "Estimativa iTree" in a.fonte and "não é dado oficial" in a.fonte
    assert "de modo uniforme" in a.metodo and "Estimativa iTree" in a.definicao
    # O número oficial por bairro continua sendo o do Censo.
    assert int(get(cidade["a"], pop.POPULACAO_CENSO).valor) == 42580


def test_estimativa_chegando_antes_do_censo_recalcula_depois(cidade):
    pop.importar_estimativa(
        planilha(70_000), fonte_url="https://ftp.ibge.gov.br/POP2026_20261029.xlsx"
    )
    assert not IndicadorTerritorialExterno.objects.filter(indicador=pop.POPULACAO_ESTIMADA).exists()
    pop.importar_populacao_censo(basico(LINHAS), total_municipal=66_776)
    assert IndicadorTerritorialExterno.objects.filter(indicador=pop.POPULACAO_ESTIMADA).count() == 2


# --- IDH --------------------------------------------------------------------------------------


def test_idh_casa_pelo_nome_com_apelido_e_relata_o_resto(cidade):
    criar_territorio("Vila Peri", codigo="2304400020", geom=quadrado(-38.50, -3.76, 0.01))
    r = pop.importar_idh(
        idh_geojson([("ALDEOTA", 0.8666), ("VILA PERY", 0.3), ("DENDE", 0.2), ("CENTRO", 0.5567)])
    )
    assert r.gravados == 3 and r.sem_casamento_no_arquivo == ["DENDE"]
    a = get(cidade["a"], pop.IDH)
    assert a.valor == Decimal("0.8666") and a.data_referencia == date(2010, 12, 31)
    assert "2010" in a.definicao and "não é atual" in a.definicao
    assert a.versao.startswith("sha256:")
    assert IndicadorTerritorialExterno.objects.filter(indicador=pop.IDH_EDUCACAO).count() == 3


def test_idh_de_dois_bairros_que_viraram_um_nao_vale_para_nenhum(cidade):
    criar_territorio("Boa Vista / Castelão", codigo="2304400030", geom=quadrado(-38.5, -3.7, 0.01))
    r = pop.importar_idh(idh_geojson([("BOA VISTA", 0.4), ("CASTELAO", 0.6), ("ALDEOTA", 0.8)]))
    assert r.gravados == 1 and sorted(r.sem_casamento_no_arquivo) == ["BOA VISTA", "CASTELAO"]


# --- Descoberta da versão na listagem ---------------------------------------------------------


def test_versao_mais_recente_vem_da_listagem():
    nomes = [
        "Agregados_por_bairros_basico_BR_20250101.zip",
        "Agregados_por_bairros_basico_BR_20260520.zip",
        "Agregados_por_bairros_demografia_BR.zip",
    ]
    assert (
        pop.versao_mais_recente(nomes, r"Agregados_por_bairros_basico_BR_\d{8}\.zip")
        == "Agregados_por_bairros_basico_BR_20260520.zip"
    )


def listar_falso(paginas):
    def listar(url):
        return paginas[url]

    return listar


def test_descobre_o_censo_mais_recente_e_aceita_outro_ano():
    paginas = {
        pop.URL_CENSOS: [
            "Censo_Demografico_2010/",
            "Censo_Demografico_2022/",
            "Censo_Demografico_2032/",
        ],
        pop.URL_CENSOS + "Censo_Demografico_2032/" + pop.DIR_BASICO: [
            "Agregados_por_bairros_basico_BR_20320601.zip"
        ],
    }
    url = pop.descobrir_basico(listar_falso(paginas))
    assert url.endswith(
        "Censo_Demografico_2032/" + pop.DIR_BASICO + "Agregados_por_bairros_basico_BR_20320601.zip"
    )
    assert pop.ano_do_censo(url) == 2032


def test_censo_novo_sem_o_arquivo_cai_no_anterior():
    def listar(url):
        if url == pop.URL_CENSOS:
            return ["Censo_Demografico_2022/", "Censo_Demografico_2032/"]
        if "2032" in url:
            return []
        return ["Agregados_por_bairros_basico_BR_20260520.zip"]

    assert "Censo_Demografico_2022" in pop.descobrir_basico(listar)


def test_descobre_a_estimativa_do_ano_mais_recente_e_a_versao_mais_nova():
    paginas = {
        pop.URL_ESTIMATIVAS: ["Estimativas_2025/", "Estimativas_2026/", "Estimativas_2024/"],
        pop.URL_ESTIMATIVAS + "Estimativas_2026/": [
            "POP2026_20261029.ods",
            "POP2026_20261029.xlsx",
            "POP2026_20260801.xlsx",
            "estimativa_dou_2026.xlsx",
        ],
    }
    assert pop.descobrir_estimativa(listar_falso(paginas)).endswith(
        "Estimativas_2026/POP2026_20261029.xlsx"
    )


def test_url_do_arquivo_por_municipio_segue_a_mesma_revisao():
    assert pop.url_do_municipio(URL_BASICO).endswith(
        "Agregados_por_Municipio_csv/Agregados_por_municipios_basico_BR_20260520.zip"
    )


# --- Comandos e renovação ---------------------------------------------------------------------


def test_comandos_importam_arquivos_locais_e_registram_a_execucao(cidade, tmp_path, capsys):
    arq = tmp_path / "Agregados_por_bairros_basico_BR_20260520.zip"
    arq.write_bytes(basico(LINHAS))
    mun = tmp_path / "municipios.zip"
    mun.write_bytes(municipios(66_776))
    call_command("importar_populacao_censo", arquivo=str(arq), arquivo_municipio=str(mun), ano=2022)
    saida = capsys.readouterr().out
    assert "2 bairro(s) gravado(s) (versão 20260520)" in saida and "diferença: +0" in saida
    assert "Bairro novo" in saida and "Sem código" in saida
    e = ExecucaoFonteExterna.objects.get(fonte=pop.FONTE_CENSO_POPULACAO)
    assert e.sucesso and e.importou and e.versao == "20260520" and e.ano_referencia == 2022

    est = tmp_path / "POP2026_20261029.xlsx"
    est.write_bytes(planilha())
    call_command("importar_estimativa_populacao", arquivo=str(est))
    assert "Estimativa de 2026" in capsys.readouterr().out
    assert ExecucaoFonteExterna.objects.filter(fonte=pop.FONTE_ESTIMATIVA, sucesso=True).exists()


def test_comando_com_arquivo_invalido_falha_e_registra(cidade, tmp_path):
    ruim = tmp_path / "x.csv"
    ruim.write_bytes(b"a;b\n1;2\n")
    with pytest.raises(CommandError, match="Colunas ausentes"):
        call_command("importar_populacao_censo", arquivo=str(ruim), ano=2022)
    e = ExecucaoFonteExterna.objects.get(fonte=pop.FONTE_CENSO_POPULACAO)
    assert not e.sucesso and "Colunas ausentes" in e.erro


def arquivos_do_ibge():
    base_c = pop.URL_CENSOS + "Censo_Demografico_2022/"
    paginas = {
        pop.URL_CENSOS: ["Censo_Demografico_2022/"],
        base_c + pop.DIR_BASICO: ["Agregados_por_bairros_basico_BR_20260520.zip"],
        base_c + pop.DIR_RENDA: ["Agregados_por_bairros_renda_responsavel_BR_20260508_csv.zip"],
        pop.URL_ESTIMATIVAS: ["Estimativas_2026/"],
        pop.URL_ESTIMATIVAS + "Estimativas_2026/": ["POP2026_20261029.xlsx"],
    }
    conteudos = {
        base_c + pop.DIR_BASICO + "Agregados_por_bairros_basico_BR_20260520.zip": basico(LINHAS),
        base_c
        + pop.DIR_BASICO.replace("Bairro", "Municipio")
        + "Agregados_por_municipios_basico_BR_20260520.zip": municipios(66_776),
        base_c
        + pop.DIR_RENDA
        + "Agregados_por_bairros_renda_responsavel_BR_20260508_csv.zip": renda(
            [("2304400002", "Aldeota", 16288, "10572,06")]
        ),
        pop.URL_ESTIMATIVAS + "Estimativas_2026/POP2026_20261029.xlsx": planilha(),
        pop.URL_IDH: idh_geojson([("ALDEOTA", 0.8666)]),
    }
    return paginas, conteudos


def test_renovacao_importa_o_que_mudou_e_nao_repete(cidade):
    paginas, conteudos = arquivos_do_ibge()
    r1 = pop.renovar(baixar_arquivo=conteudos.__getitem__, listar=listar_falso(paginas))
    assert {x["fonte"]: x["situacao"] for x in r1} == dict.fromkeys(pop.FONTES, "importado")
    assert get(cidade["a"], pop.POPULACAO_ESTIMADA)
    # Segunda conferência, sem novidade: só registra a conferência.
    r2 = pop.renovar(baixar_arquivo=conteudos.__getitem__, listar=listar_falso(paginas))
    assert {x["situacao"] for x in r2} == {"sem_novidade"}
    assert ExecucaoFonteExterna.objects.count() == 8
    # Revisão nova do Censo (sufixo de data): reimporta só essa fonte.
    chave = pop.URL_CENSOS + "Censo_Demografico_2022/" + pop.DIR_BASICO
    paginas[chave] = ["Agregados_por_bairros_basico_BR_20260901.zip"]
    conteudos[chave + "Agregados_por_bairros_basico_BR_20260901.zip"] = basico(LINHAS)
    r3 = pop.renovar(baixar_arquivo=conteudos.__getitem__, listar=listar_falso(paginas))
    situacoes = {x["fonte"]: x["situacao"] for x in r3}
    assert situacoes[pop.FONTE_CENSO_POPULACAO] == "importado"
    assert situacoes[pop.FONTE_ESTIMATIVA] == "sem_novidade"
    assert get(cidade["a"], pop.POPULACAO_CENSO).versao == "20260901"
    # Estimativa nova (versão nova no ano): reimporta.
    pagina_est = pop.URL_ESTIMATIVAS + "Estimativas_2026/"
    paginas[pagina_est] = ["POP2026_20261129.xlsx"]
    conteudos[pagina_est + "POP2026_20261129.xlsx"] = planilha(2_600_000)
    r4 = pop.renovar(baixar_arquivo=conteudos.__getitem__, listar=listar_falso(paginas))
    assert {x["fonte"]: x["situacao"] for x in r4}[pop.FONTE_ESTIMATIVA] == "importado"
    assert get(cidade["municipio"], pop.ESTIMATIVA_MUNICIPIO).numerador == 2_600_000


def test_renovacao_registra_falha_sem_derrubar_as_outras_fontes(cidade):
    paginas, conteudos = arquivos_do_ibge()
    del conteudos[pop.URL_IDH]  # o IDH fica indisponível
    r = pop.renovar(baixar_arquivo=conteudos.__getitem__, listar=listar_falso(paginas))
    situacoes = {x["fonte"]: x["situacao"] for x in r}
    assert situacoes[pop.FONTE_IDH] == "falha"
    assert situacoes[pop.FONTE_CENSO_POPULACAO] == "importado"
    falha = ExecucaoFonteExterna.objects.get(fonte=pop.FONTE_IDH)
    assert not falha.sucesso and falha.erro
    s = {x["fonte"]: x for x in pi.situacao_das_fontes()}
    assert s[pop.FONTE_IDH]["falhou"] and s[pop.FONTE_IDH]["desatualizada"]
    assert not s[pop.FONTE_CENSO_POPULACAO]["falhou"]


def test_fonte_desatualizada_apos_o_limite(cidade):
    pop.registrar_execucao(pop.FONTE_ESTIMATIVA, sucesso=True, importou=True, versao="20261029")
    ExecucaoFonteExterna.objects.update(iniciada_em=timezone.now() - timezone.timedelta(days=46))
    [s] = pi.situacao_das_fontes()
    assert s["desatualizada"] and s["versao"] == "20261029" and not s["falhou"]


def test_beat_mensal_registrado(settings):
    from config.settings import CELERY_BEAT_SCHEDULE

    t = CELERY_BEAT_SCHEDULE["renovar-fontes-populacao"]
    assert t["task"] == "itree.indicadores.tasks.renovar_fontes_populacao"
    assert t["schedule"].day_of_month == {6}


def test_tarefa_chama_a_renovacao(monkeypatch):
    from itree.indicadores import tasks

    chamadas = []
    monkeypatch.setattr(pop, "renovar", lambda origem: chamadas.append(origem) or [])
    tasks.renovar_fontes_populacao()
    assert chamadas == ["agendada"]


# --- Indicadores por bairro -------------------------------------------------------------------


def arvore(bairro_ponto):
    return Arvore.objects.create(
        origem_registro="importacao",
        localizacao_origem="importada",
        geom=Point(bairro_ponto[0], bairro_ponto[1], srid=4326),
    )


@pytest.fixture
def dados(cidade):
    pop.importar_populacao_censo(basico(LINHAS), total_municipal=66_776)
    pop.importar_renda(
        renda([("2304400002", "Aldeota", 100, "9000"), ("2304400010", "Centro", 300, "3000")])
    )
    pop.importar_idh(idh_geojson([("ALDEOTA", 0.86)]))
    for _ in range(4):
        arvore((-38.555, -3.755))  # Aldeota
    arvore((-38.535, -3.755))  # Centro
    return cidade


def test_por_mil_e_habitantes_por_arvore(dados):
    q = {x["nome"]: x for x in pi.quadro(None)}
    assert q["Aldeota"]["arvores"] == 4
    assert q["Aldeota"]["por_mil"] == pytest.approx(1000 * 4 / 42580, abs=0.01)
    assert q["Aldeota"]["hab_por_arvore"] == pytest.approx(42580 / 4, abs=0.1)
    assert q["Aldeota"]["idh"] == 0.86 and q["Centro"]["idh"] is None  # sem dado, nunca zero
    r = pi.resumo(list(q.values()))
    # A referência soma árvores e população; renda é ponderada pelos responsáveis.
    assert r["por_mil"] == pytest.approx(1000 * 5 / (42580 + 24096))
    assert r["renda"] == pytest.approx((9000 * 100 + 3000 * 300) / 400)


def test_bairro_sem_arvores_tem_zero_por_mil_e_sem_habitantes_por_arvore(dados):
    Arvore.objects.all().delete()
    q = {x["nome"]: x for x in pi.quadro(None)}
    assert q["Aldeota"]["por_mil"] == 0 and q["Aldeota"]["hab_por_arvore"] is None


def test_quebras_por_quantis_da_distribuicao_real():
    q = pi.quebras_quantis(list(range(1, 101)))
    assert q == [pytest.approx(v, abs=1) for v in (20.8, 40.6, 60.4, 80.2)] and len(q) == 4
    assert pi.quebras_quantis([1, 2]) == []  # poucos bairros: sem classes
    assert pi.quebras_quantis([5.0] * 30) == []  # valores iguais: sem classes vazias


def autorizado(cliente, usuario):
    return cliente.como(usuario)


def test_geojson_traz_indicadores_quebras_proveniencia_e_provisorio(cliente, dados):
    gestor = com_escopo(criar_usuario("g@itree.teste", ["gestor"]), dados["municipio"])
    corpo = autorizado(cliente, gestor).get("/api/v1/indicadores/externos/populacao").json()
    por_id = {i["id"]: i for i in corpo["indicadores"]}
    assert set(por_id) == {
        "densidade",
        "arvores_por_mil",
        "renda",
        "idh",
        "iptu_medio",
        "iptu_inscricoes",
        "area_residencial",
        "area_comercial",
        "regra_3",
        "regra_30",
        "regra_300",
    }
    assert (
        por_id["arvores_por_mil"]["provisorio"]
        and "falta de cadastro" in por_id["arvores_por_mil"]["ressalva"]
    )
    assert not por_id["densidade"]["provisorio"]
    assert por_id["renda"]["proveniencia"]["fonte_url"] and por_id["idh"]["proveniencia"][
        "data_referencia"
    ].startswith("2010")
    props = {f["properties"]["nome"]: f["properties"] for f in corpo["features"]}
    assert props["Centro"]["idh"] is None and props["Aldeota"]["renda"] == 9000
    assert props["Sem código"]["densidade"] is None


def test_escopo_restringe_bairros_e_cartoes_da_ficha(cliente, dados):
    tecnico = com_escopo(criar_usuario("t@itree.teste", ["tecnico"]), dados["a"])
    corpo = autorizado(cliente, tecnico).get("/api/v1/indicadores/externos/populacao").json()
    assert [f["properties"]["nome"] for f in corpo["features"]] == ["Aldeota"]
    assert (
        autorizado(cliente, tecnico).get(f"/api/v1/bairros/{dados['b'].id}/ficha").status_code
        == 403
    )


def ficha_cartoes(cliente, usuario, bairro):
    r = cliente.como(usuario).get(f"/api/v1/bairros/{bairro.id}/ficha")
    assert r.status_code == 200
    return {c["id"]: c for c in r.json()["cartoes"]}


def test_ficha_tem_cartoes_novos_com_ressalva_selo_provisorio_e_regua(cliente, dados):
    pop.importar_estimativa(
        planilha(70_000), fonte_url="https://ftp.ibge.gov.br/POP2026_20261029.xlsx"
    )
    gestor = com_escopo(criar_usuario("g@itree.teste", ["gestor"]), dados["municipio"])
    c = ficha_cartoes(cliente, gestor, dados["a"])
    assert c["populacao"]["valor"] == 42580 and "Estimativa iTree" in c["populacao"]["nota"]
    assert "crescimento uniforme" in c["populacao"]["nota"]
    assert c["densidade"]["unidade"] == "hab/km²" and c["densidade"]["cidade"]["valor"] > 0
    mil = c["arvores_por_mil"]
    assert mil["provisorio"] and "falta de cadastro" in mil["nota"]
    assert "oficial" not in mil["titulo"].lower() and "habitantes por árvore" in mil["detalhe"]
    assert mil["cidade"]["valor"] == pytest.approx(1000 * 5 / 66_676, abs=0.01)
    assert mil["escala"]["min"] < mil["escala"]["max"]
    assert c["renda"]["valor"] == 9000 and "Rendimento médio do responsável" in c["renda"]["titulo"]
    assert "per capita" in c["renda"]["nota"]
    assert c["idh"]["valor"] == pytest.approx(0.86) and "2010" in c["idh"]["titulo"]
    assert "não é atual" in c["idh"]["nota"]


def test_ficha_de_bairro_sem_idh_diz_que_nao_ha_dado(cliente, dados):
    gestor = com_escopo(criar_usuario("g@itree.teste", ["gestor"]), dados["municipio"])
    c = ficha_cartoes(cliente, gestor, dados["b"])["idh"]
    assert c["sem_dado"] and c["valor"] is None and "2010" in c["nota"]


def test_analises_por_bairro_com_colunas_ressalvas_e_dispersao(cliente, dados):
    gestor = com_escopo(criar_usuario("g@itree.teste", ["gestor"]), dados["municipio"])
    cl = cliente.como(gestor)
    a = cl.get("/api/v1/relatorios/analise?analise=arvores_por_mil_habitantes_por_bairro").json()
    assert a["provisorio"] and a["ordenavel"] and a["total"] is None
    assert any("falta de cadastro" in r for r in a["ressalvas"])
    assert [x["rotulo"] for x in a["linhas"]] == ["Aldeota", "Centro"]  # 0,094 e 0,042 por mil
    assert {c["chave"] for c in a["colunas_csv"]} >= {"rotulo", "valor", "arvores", "populacao"}
    p = cl.get("/api/v1/relatorios/analise?analise=populacao_densidade_por_bairro").json()
    assert p["total"] == 42580 + 24096 and p["linhas"][0]["rotulo"] == "Aldeota"
    assert "densidade" in p["linhas"][0] and "hab/km²" in p["linhas"][0]["detalhe"]
    d = cl.get("/api/v1/relatorios/analise?analise=arvores_mil_x_renda").json()
    assert d["dispersao"]["correlacao"]["bairros"] == 2
    assert d["dispersao"]["correlacao"]["r"] is None or -1 <= d["dispersao"]["correlacao"]["r"] <= 1
    assert "não mede causa" in d["dispersao"]["correlacao"]["metodo"]
    assert {pt["rotulo"] for pt in d["dispersao"]["pontos"]} == {"Aldeota", "Centro"}


def test_analise_respeita_o_escopo(cliente, dados):
    gestor_a = com_escopo(criar_usuario("ga@itree.teste", ["gestor"]), dados["a"])
    a = (
        cliente.como(gestor_a)
        .get("/api/v1/relatorios/analise?analise=populacao_densidade_por_bairro")
        .json()
    )
    assert [x["rotulo"] for x in a["linhas"]] == ["Aldeota"]


def test_visao_geral_tem_o_valor_da_cidade_com_selo_provisorio(dados):
    gestor = com_escopo(criar_usuario("g@itree.teste", ["gestor"]), dados["municipio"])
    from itree.indicadores import externos

    item = next(i for i in externos.contexto_externo(gestor) if i["id"] == pi.POR_MIL)
    assert "provisório" in item["nome"] and item["numerador"] == 5 and item["base"] == 66_676
    assert "falta de cadastro" in item["definicao"]


def test_camadas_trazem_a_situacao_das_fontes(cliente, dados):
    pop.registrar_execucao(
        pop.FONTE_CENSO_POPULACAO, sucesso=True, importou=True, versao="20260520"
    )
    gestor = com_escopo(criar_usuario("g@itree.teste", ["gestor"]), dados["municipio"])
    corpo = cliente.como(gestor).get("/api/v1/mapa/camadas").json()
    assert corpo["populacao"][0]["fonte"] == pop.FONTE_CENSO_POPULACAO
