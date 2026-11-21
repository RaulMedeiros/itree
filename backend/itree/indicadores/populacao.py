"""População, renda e IDH por bairro, de fontes oficiais com renovação automática.

Fontes (todas verificadas em 21/11/2026):

- **Censo 2022, agregados por bairro, "básico"** (IBGE, FTP): ``V0001`` população residente,
  ``V0002`` total de domicílios (dicionário ``dicionario_de_dados_agregados_por_setores_
  censitarios_*.xlsx``). A população total do município vem do mesmo arquivo "por município".
- **Censo 2022, rendimento do responsável** (IBGE, FTP): ``V06004`` valor do rendimento nominal
  médio mensal das pessoas responsáveis com rendimento, em R$ de 2022; ``V06001`` pessoas
  responsáveis (dicionário ``dicionario_de_dados_renda_responsavel_*.xlsx``).
- **Estimativas anuais da população** (IBGE, FTP): só por município; usa-se a versão mais recente do
  ano mais recente. A estimativa por bairro é do iTree (Censo × razão municipal), não é oficial.
- **IDH por bairro, 2010** (SDE, Prefeitura de Fortaleza, base no Censo 2010), pelo Fortaleza em
  Mapas (ids 31 a 35). Dado antigo, com limites de bairro da época: sempre mostrado com o ano.

O nome do arquivo do IBGE leva a data da revisão (``..._20260520.zip``): o nome atual vem da
listagem do diretório, nunca é fixo. O ano de referência do Censo vem do caminho do arquivo
(``Censo_Demografico_AAAA``), então o Censo de 2032 entra sem mudança de código.

Os arquivos baixados são dados não confiáveis: lidos em memória, com limite de tamanho, só de
hosts da lista, e os ZIP só com um CSV de tamanho limitado.
"""

import csv
import hashlib
import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from urllib.parse import urljoin, urlparse

import requests
from django.conf import settings
from django.contrib.gis.db.models.functions import Transform
from django.db import transaction
from django.db.models import F, FloatField, Func
from django.utils import timezone

from itree.territorio.models import Territorio, TipoTerritorio

from .manejo_urbfor import IndiceBairros
from .models import ExecucaoFonteExterna, IndicadorTerritorialExterno

# --- Identificadores -----------------------------------------------------------------------------

POPULACAO_CENSO = "populacao_censo"
DOMICILIOS_CENSO = "domicilios_censo"
DENSIDADE = "densidade_populacional"
POPULACAO_ESTIMADA = "populacao_estimada_itree"
CENSO_MUNICIPIO = "populacao_censo_municipio"
ESTIMATIVA_MUNICIPIO = "populacao_estimativa_ibge_municipio"
RENDA = "renda_responsavel_media"
IDH = "idh_2010"
IDH_EDUCACAO = "idh_educacao_2010"
IDH_LONGEVIDADE = "idh_longevidade_2010"
IDH_RENDA = "idh_renda_2010"

FONTE_CENSO_POPULACAO = "censo_populacao"
FONTE_CENSO_RENDA = "censo_renda"
FONTE_ESTIMATIVA = "estimativa_populacao"
FONTE_IDH = "idh_bairros"
FONTES = {
    FONTE_CENSO_POPULACAO: "População do Censo 2022 por bairro (IBGE)",
    FONTE_CENSO_RENDA: "Rendimento do responsável, Censo 2022 (IBGE)",
    FONTE_ESTIMATIVA: "Estimativa anual da população de Fortaleza (IBGE)",
    FONTE_IDH: "IDH 2010 por bairro (SDE, Prefeitura de Fortaleza)",
}
# A tarefa roda todo mês; sem conferência bem-sucedida há mais que isto, a fonte está desatualizada.
IDADE_MAXIMA_DIAS = 45

ORGAO_IBGE = "IBGE"
LICENCA_IBGE = "Não declarada no FTP do IBGE; política de dados abertos do órgão a confirmar"
FTP = "https://ftp.ibge.gov.br/"
URL_CENSOS = FTP + "Censos/"
DIR_BASICO = "Agregados_por_Setores_Censitarios/Agregados_por_Bairro_csv/"
DIR_BASICO_MUNICIPIO = "Agregados_por_Setores_Censitarios/Agregados_por_Municipio_csv/"
DIR_RENDA = "Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel/"
URL_ESTIMATIVAS = FTP + "Estimativas_de_Populacao/"
URL_CENSO_BASICO = (
    URL_CENSOS
    + "Censo_Demografico_2022/"
    + DIR_BASICO
    + "Agregados_por_bairros_basico_BR_20260520.zip"
)
URL_CENSO_RENDA = (
    URL_CENSOS
    + "Censo_Demografico_2022/"
    + DIR_RENDA
    + "Agregados_por_bairros_renda_responsavel_BR_20260508_csv.zip"
)
URL_IDH = "https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=35"
URL_IDH_CKAN = (
    "https://dados.fortaleza.ce.gov.br/api/3/action/package_show?id=desenvolvimento_humano_bairro"
)
CODIGO_IBGE_FORTALEZA = "2304400"
HOSTS_PERMITIDOS = {"ftp.ibge.gov.br", "mapas.fortaleza.ce.gov.br", "dados.fortaleza.ce.gov.br"}
MAX_BYTES_DOWNLOAD = 60 * 1024 * 1024
MAX_BYTES_DESCOMPACTADO = 80 * 1024 * 1024

PADRAO_VERSAO = re.compile(r"_(\d{8})(?=[_.])")
PADRAO_ANO_CENSO = re.compile(r"Censo_Demografico_(\d{4})")

NOME_RENDA = "Rendimento médio do responsável pelo domicílio (Censo 2022)"
NOME_POPULACAO = "População residente (Censo 2022)"
NOME_IDH = "IDH 2010 (SDE, Prefeitura de Fortaleza)"

DEFINICAO_POPULACAO = (
    "Pessoas residentes no bairro na data de referência do Censo Demográfico (variável V0001 dos "
    "agregados por bairro, tabela básica). É o número oficial; as estimativas anuais do IBGE não "
    "existem por bairro."
)
METODO_POPULACAO = (
    "Soma de pessoas residentes (V0001) por código de bairro do IBGE, casado com o código dos "
    "bairros oficiais. Densidade = população ÷ área do polígono oficial do bairro, calculada em "
    "SIRGAS 2000 / UTM 24S (EPSG:31984), em habitantes por km²."
)
DEFINICAO_ESTIMATIVA = (
    "Estimativa iTree, não dado oficial: o IBGE estima a população só por município. A população "
    "do bairro no ano é a do Censo multiplicada pela razão entre a estimativa do município no ano "
    "e a população do município no Censo."
)
METODO_ESTIMATIVA = (
    "População do Censo do bairro × (estimativa do município no ano ÷ população do município no "
    "Censo). Hipótese: o município cresce de modo uniforme entre os bairros, o que não é "
    "verdade na prática (bairros novos crescem mais, bairros antigos perdem moradores). Use só "
    "como ordem de grandeza; o número oficial por bairro é o do Censo."
)
DEFINICAO_RENDA = (
    "Valor do rendimento nominal médio mensal das pessoas responsáveis pelos domicílios "
    "particulares permanentes ocupados que declararam rendimento, em R$ de 2022 (variável V06004). "
    "É o rendimento do responsável pelo domicílio, não renda per capita nem renda domiciliar."
)
METODO_RENDA = (
    "Valor V06004 do arquivo de rendimento do responsável, por código de bairro do IBGE. A "
    "referência de Fortaleza é a média dos bairros ponderada pelo número de pessoas responsáveis "
    "(V06001), uma aproximação, pois V06001 inclui responsáveis sem rendimento."
)
DEFINICAO_IDH = (
    "Índice de Desenvolvimento Humano por bairro de Fortaleza, calculado pela Secretaria de "
    "Desenvolvimento Econômico (SDE) com base no Censo 2010, com as dimensões educação, "
    "longevidade e renda. É um dado de 2010: não é atual, e os limites dos bairros da época "
    "diferem dos atuais."
)
METODO_IDH = (
    "Valores publicados pela SDE no Fortaleza em Mapas (camadas 31 a 35, mesma tabela), casados "
    "com os bairros oficiais pelo nome (sem acento nem caixa, com os apelidos já usados no "
    "sistema). Bairro sem nome equivalente não recebe valor. O iTree não estima IDH novo. "
    "Faixas do PNUD: abaixo de 0,500 muito baixo; 0,500 a 0,599 baixo; 0,600 a 0,699 médio; "
    "0,700 a 0,799 alto; 0,800 ou mais muito alto."
)
FONTE_IDH_TEXTO = (
    "SDE, Prefeitura de Fortaleza (IDH 2010, base no Censo 2010), via Fortaleza em Mapas"
)
LICENCA_IDH = (
    "Fortaleza em Mapas: uso livre com citação da fonte (termos da API). O conjunto no portal de "
    "dados abertos (desenvolvimento_humano_bairro) é cc-by-sa"
)
# Nomes do IDH 2010 que o sistema escreve diferente.
APELIDOS_IDH = {
    "eng luciano cavalcante": "Engenheiro Luciano Cavalcante",
    "sao joao do tauape": "Tauape",
    "alto da balanca": "Alto da Balança",
    "vila ellery": "Ellery",
    "vila pery": "Vila Peri",
    "prefeito jose valter": "Prefeito José Walter",
}

FAIXAS_IDH = [
    (0.8, "muito alto"),
    (0.7, "alto"),
    (0.6, "médio"),
    (0.5, "baixo"),
    (0.0, "muito baixo"),
]


def faixa_idh(valor: float) -> str:
    return next(nome for limite, nome in FAIXAS_IDH if valor >= limite)


class FonteInvalida(ValueError):
    """O arquivo não tem o formato esperado."""


class AreaUtm(Func):
    """Área em m² do polígono, em SIRGAS 2000 / UTM 24S (projeção métrica de Fortaleza)."""

    function = "ST_Area"
    output_field = FloatField()

    def __init__(self, expressao):
        super().__init__(Transform(expressao, 31984))


# --- Rede (conteúdo não confiável) ---------------------------------------------------------------


def _exigir_host(url: str) -> None:
    p = urlparse(url)
    if p.scheme != "https" or p.hostname not in HOSTS_PERMITIDOS:
        raise FonteInvalida(f"Endereço fora da lista de fontes permitidas: {url}")


def baixar(url: str, limite: int = MAX_BYTES_DOWNLOAD) -> bytes:
    """Baixa até ``limite`` bytes de um host permitido; mais que isso é recusado."""
    _exigir_host(url)
    with requests.get(url, timeout=getattr(settings, "IBGE_TIMEOUT", 120), stream=True) as r:
        r.raise_for_status()
        partes, total = [], 0
        for parte in r.iter_content(64 * 1024):
            total += len(parte)
            if total > limite:
                raise FonteInvalida(f"Arquivo maior que o limite de {limite // 1024 // 1024} MB.")
            partes.append(parte)
    return b"".join(partes)


def listar_diretorio(url: str) -> list[str]:
    """Nomes (arquivos e subpastas) da listagem HTML de um diretório do FTP do IBGE."""
    html = baixar(url, limite=5 * 1024 * 1024).decode("utf-8", "replace")
    nomes = []
    for href in re.findall(r'href="([^"?]+)"', html):
        if href.startswith(("http", "/", "#", "?")) or ".." in href:
            continue
        nomes.append(href)
    return nomes


# --- Descoberta da versão mais recente -----------------------------------------------------------


def _versao_do_nome(nome: str) -> str:
    m = PADRAO_VERSAO.search(nome)
    return m.group(1) if m else ""


def ano_do_censo(url: str, padrao: int | None = None) -> int | None:
    m = PADRAO_ANO_CENSO.search(url)
    return int(m.group(1)) if m else padrao


def versao_mais_recente(nomes: list[str], padrao: str) -> str | None:
    """Entre ``nomes``, o que casa com ``padrao`` e tem o sufixo de data mais recente."""
    casados = [n for n in nomes if re.fullmatch(padrao, n)]
    if not casados:
        return None
    return max(casados, key=lambda n: (_versao_do_nome(n), n))


def _anos_de_censo(listar=listar_diretorio) -> list[int]:
    anos = []
    for nome in listar(URL_CENSOS):
        m = re.fullmatch(r"Censo_Demografico_(\d{4})/", nome)
        if m:
            anos.append(int(m.group(1)))
    return sorted(anos, reverse=True)


def descobrir_censo(
    diretorio: str, padrao: str, listar=listar_diretorio, anos: list[int] | None = None
) -> str | None:
    """URL do arquivo mais recente do Censo mais recente que o tenha. ``diretorio`` é o caminho
    depois de ``Censo_Demografico_AAAA/``. O ano vem do caminho; nada é fixo no código."""
    for ano in anos if anos is not None else _anos_de_censo(listar):
        base = f"{URL_CENSOS}Censo_Demografico_{ano}/{diretorio}"
        try:
            nome = versao_mais_recente(listar(base), padrao)
        except (requests.RequestException, FonteInvalida):
            continue
        if nome:
            return urljoin(base, nome)
    return None


def descobrir_basico(listar=listar_diretorio) -> str | None:
    return descobrir_censo(DIR_BASICO, r"Agregados_por_bairros_basico_BR_\d{8}\.zip", listar)


def descobrir_renda(listar=listar_diretorio) -> str | None:
    return descobrir_censo(
        DIR_RENDA, r"Agregados_por_bairros_renda_responsavel_BR_\d{8}_csv\.zip", listar
    )


def url_do_municipio(url_bairro: str) -> str:
    """Arquivo "por município" da mesma revisão do arquivo "por bairro" do Censo."""
    return url_bairro.replace("Agregados_por_Bairro_csv", "Agregados_por_Municipio_csv").replace(
        "Agregados_por_bairros_", "Agregados_por_municipios_"
    )


def descobrir_estimativa(listar=listar_diretorio) -> str | None:
    """Estimativa municipal mais recente: o maior ano e, nele, a versão de data mais recente.
    Prefere XLSX (lido sem dependência extra); o ODS e o XLS só entram se não houver XLSX."""
    anos = sorted(
        (
            int(m.group(1))
            for n in listar(URL_ESTIMATIVAS)
            if (m := re.fullmatch(r"Estimativas_(\d{4})/", n))
        ),
        reverse=True,
    )
    for ano in anos:
        base = f"{URL_ESTIMATIVAS}Estimativas_{ano}/"
        try:
            nomes = listar(base)
        except (requests.RequestException, FonteInvalida):
            continue
        for extensao in ("xlsx", "xls", "ods"):
            nome = versao_mais_recente(nomes, rf"POP{ano}_\d{{8}}\.{extensao}")
            if nome:
                return urljoin(base, nome)
    return None


# --- Leitura -------------------------------------------------------------------------------------


def _csv_do_conteudo(conteudo: bytes) -> str:
    if zipfile.is_zipfile(io.BytesIO(conteudo)):
        with zipfile.ZipFile(io.BytesIO(conteudo)) as z:
            itens = [i for i in z.infolist() if i.filename.lower().endswith(".csv")]
            if len(itens) != 1:
                raise FonteInvalida("O ZIP deve conter exatamente um CSV.")
            if itens[0].file_size > MAX_BYTES_DESCOMPACTADO:
                raise FonteInvalida("CSV descompactado maior que o limite.")
            conteudo = z.read(itens[0])
    if len(conteudo) > MAX_BYTES_DESCOMPACTADO:
        raise FonteInvalida("CSV maior que o limite.")
    return conteudo.decode("iso-8859-1")  # o IBGE publica em ISO-8859-1


def _numero(texto: str | None) -> Decimal | None:
    """Número do IBGE ("1234", "10572,06"); "." ou "X" (sigilo) e vazio viram ``None``."""
    t = (texto or "").strip()
    if not t or t in {".", "X", "-"}:
        return None
    try:
        return Decimal(t.replace(".", "").replace(",", ".")) if "," in t else Decimal(t)
    except ArithmeticError:
        return None


def _linhas_csv(conteudo: bytes, obrigatorias: set[str]) -> list[dict[str, str]]:
    leitor = csv.DictReader(io.StringIO(_csv_do_conteudo(conteudo)), delimiter=";")
    # Os cabeçalhos mudam de caixa entre arquivos ("v0001" e "V06004"): normaliza.
    leitor.fieldnames = [(c or "").strip().upper() for c in (leitor.fieldnames or [])]
    faltam = obrigatorias - set(leitor.fieldnames)
    if faltam:
        raise FonteInvalida("Colunas ausentes: " + ", ".join(sorted(faltam)))
    return list(leitor)


@dataclass
class LeituraCenso:
    #: código do bairro -> (população, domicílios)
    por_bairro: dict[str, tuple[int, int | None]] = field(default_factory=dict)
    nomes: dict[str, str] = field(default_factory=dict)
    invalidas: int = 0


def ler_basico(conteudo: bytes, municipio: str = CODIGO_IBGE_FORTALEZA) -> LeituraCenso:
    linhas = _linhas_csv(conteudo, {"CD_BAIRRO", "NM_BAIRRO", "CD_MUN", "V0001", "V0002"})
    leitura = LeituraCenso()
    for linha in linhas:
        if (linha["CD_MUN"] or "").strip() != municipio:
            continue
        codigo = linha["CD_BAIRRO"].strip()
        pessoas, domicilios = _numero(linha["V0001"]), _numero(linha["V0002"])
        if pessoas is None or pessoas < 0:
            leitura.invalidas += 1
            continue
        leitura.por_bairro[codigo] = (
            int(pessoas),
            int(domicilios) if domicilios is not None else None,
        )
        leitura.nomes[codigo] = linha["NM_BAIRRO"].strip()
    return leitura


def ler_total_municipio(conteudo: bytes, municipio: str = CODIGO_IBGE_FORTALEZA) -> int | None:
    for linha in _linhas_csv(conteudo, {"CD_MUN", "V0001"}):
        if (linha["CD_MUN"] or "").strip() == municipio:
            valor = _numero(linha["V0001"])
            return int(valor) if valor is not None else None
    return None


@dataclass
class LeituraRenda:
    #: código do bairro -> (renda média, responsáveis)
    por_bairro: dict[str, tuple[Decimal, int]] = field(default_factory=dict)
    nomes: dict[str, str] = field(default_factory=dict)
    sem_valor: int = 0


def ler_renda(conteudo: bytes, municipio: str = CODIGO_IBGE_FORTALEZA) -> LeituraRenda:
    linhas = _linhas_csv(conteudo, {"CD_BAIRRO", "NM_BAIRRO", "V06001", "V06004"})
    leitura = LeituraRenda()
    for linha in linhas:
        codigo = linha["CD_BAIRRO"].strip()
        if not codigo.startswith(municipio):
            continue
        renda, responsaveis = _numero(linha["V06004"]), _numero(linha["V06001"])
        if renda is None or renda < 0 or responsaveis is None:
            leitura.sem_valor += 1
            continue
        leitura.por_bairro[codigo] = (renda, int(responsaveis))
        leitura.nomes[codigo] = linha["NM_BAIRRO"].strip()
    return leitura


@dataclass
class LeituraEstimativa:
    populacao: int
    ano: int
    data_referencia: date


def ler_estimativa(conteudo: bytes, municipio: str = CODIGO_IBGE_FORTALEZA) -> LeituraEstimativa:
    """Estimativa do município na planilha ``POPAAAA_*.xlsx`` do IBGE (aba "MUNICÍPIOS")."""
    from openpyxl import load_workbook

    if len(conteudo) > MAX_BYTES_DOWNLOAD:
        raise FonteInvalida("Planilha maior que o limite.")
    if not zipfile.is_zipfile(io.BytesIO(conteudo)):
        raise FonteInvalida("Só planilhas XLSX são lidas (o IBGE publica XLSX a partir de 2026).")
    try:
        livro = load_workbook(io.BytesIO(conteudo), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        raise FonteInvalida(f"Planilha ilegível: {exc}") from exc
    aba = next((n for n in livro.sheetnames if "MUNIC" in n.upper()), None)
    if aba is None:
        raise FonteInvalida("Aba de municípios não encontrada.")
    cod_uf, cod_mun = municipio[:2], municipio[2:]
    ano = data = populacao = None
    for linha in livro[aba].iter_rows(values_only=True):
        if not linha:
            continue
        titulo = str(linha[0] or "")
        m = re.search(r"DATA DE REFER[ÊE]NCIA EM (\d+).{1,4}? DE (\w+) DE (\d{4})", titulo.upper())
        if m and ano is None:
            meses = [
                "JANEIRO",
                "FEVEREIRO",
                "MARÇO",
                "ABRIL",
                "MAIO",
                "JUNHO",
                "JULHO",
                "AGOSTO",
                "SETEMBRO",
                "OUTUBRO",
                "NOVEMBRO",
                "DEZEMBRO",
            ]
            if m.group(2) in meses:
                ano = int(m.group(3))
                data = date(ano, meses.index(m.group(2)) + 1, int(m.group(1)))
        if len(linha) > 4 and str(linha[1]).strip() == cod_uf and str(linha[2]).strip() == cod_mun:
            digitos = re.sub(r"\D", "", re.sub(r"\(.*?\)", "", str(linha[4])))
            if digitos:
                populacao = int(digitos)
                break
    if populacao is None:
        raise FonteInvalida(f"Município {municipio} ausente na planilha.")
    if ano is None or data is None:
        raise FonteInvalida("Data de referência da estimativa não encontrada no título da aba.")
    return LeituraEstimativa(populacao=populacao, ano=ano, data_referencia=data)


@dataclass
class LeituraIdh:
    #: nome normalizado -> (nome original, idh, educação, longevidade, renda)
    registros: list[dict] = field(default_factory=list)
    ano: int = 2010
    versao: str = ""


def ler_idh(conteudo: bytes) -> LeituraIdh:
    try:
        d = json.loads(conteudo)
        feicoes = d["features"]
    except (ValueError, KeyError, TypeError) as exc:
        raise FonteInvalida("GeoJSON do IDH ilegível.") from exc
    leitura = LeituraIdh()
    anos = set()
    for f in feicoes:
        p = f.get("properties") or {}
        try:
            registro = {
                "nome": str(p["nome"]).strip(),
                "idh": float(p["idh"]),
                "educacao": float(p["idh_educ"]),
                "longevidade": float(p["idh_longev"]),
                "renda": float(p["idh_renda"]),
            }
        except (KeyError, TypeError, ValueError):
            continue
        if not all(0 <= registro[k] <= 1 for k in ("idh", "educacao", "longevidade", "renda")):
            continue
        anos.add(p.get("ano_ref"))
        leitura.registros.append(registro)
    if not leitura.registros:
        raise FonteInvalida("Nenhum bairro com IDH válido no arquivo.")
    if len(anos) == 1 and isinstance(next(iter(anos)), int):
        leitura.ano = next(iter(anos))
    resumo = json.dumps(sorted(leitura.registros, key=lambda r: r["nome"]), sort_keys=True)
    leitura.versao = "sha256:" + hashlib.sha256(resumo.encode()).hexdigest()[:12]
    return leitura


# --- Gravação ------------------------------------------------------------------------------------


@dataclass
class Resultado:
    gravados: int = 0
    sem_casamento_no_arquivo: list[str] = field(
        default_factory=list
    )  # linhas do arquivo sem bairro
    bairros_sem_dado: list[str] = field(default_factory=list)  # bairros oficiais sem linha
    total_arquivo: int | None = None
    total_municipal: int | None = None
    diferenca: int | None = None
    extras: dict = field(default_factory=dict)

    def resumo(self) -> dict:
        return {
            "gravados": self.gravados,
            "sem_casamento_no_arquivo": self.sem_casamento_no_arquivo,
            "bairros_sem_dado": self.bairros_sem_dado,
            "total_arquivo": self.total_arquivo,
            "total_municipal": self.total_municipal,
            "diferenca": self.diferenca,
            **self.extras,
        }


def _bairros() -> dict[str, Territorio]:
    return {t.codigo: t for t in Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO)}


def municipio() -> Territorio | None:
    return Territorio.objects.filter(tipo=TipoTerritorio.MUNICIPIO).order_by("nome").first()


def _versao(url: str, versao: str | None) -> str:
    return versao if versao is not None else _versao_do_nome(url)


def _grava(territorio, indicador, *, valor, numerador, denominador=None, unidade="", **comum):
    IndicadorTerritorialExterno.objects.update_or_create(
        territorio=territorio,
        indicador=indicador,
        defaults={
            "valor": valor,
            "numerador": numerador,
            "denominador": denominador,
            "unidade": unidade,
            **comum,
        },
    )


def importar_populacao_censo(
    conteudo: bytes,
    *,
    fonte_url: str = URL_CENSO_BASICO,
    ano: int | None = None,
    versao: str | None = None,
    total_municipal: int | None = None,
    ingerido_em=None,
) -> Resultado:
    """Grava população, domicílios e densidade por bairro (idempotente) e, havendo o total
    municipal do Censo, confere a soma dos bairros contra ele."""
    leitura = ler_basico(conteudo)
    if not leitura.por_bairro:
        raise FonteInvalida("Nenhum bairro de Fortaleza no arquivo.")
    ano = ano or ano_do_censo(fonte_url, 2022)
    agora = ingerido_em or timezone.now()
    bairros = _bairros()
    areas = {
        pk: area
        for pk, area in Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO).values_list(
            "pk", AreaUtm(F("geom"))
        )
    }
    comum = {
        "fonte": f"{ORGAO_IBGE}, Censo Demográfico {ano}",
        "fonte_url": fonte_url,
        "licenca": LICENCA_IBGE,
        "data_referencia": date(ano, 7, 31),
        "ingerido_em": agora,
        "versao": _versao(fonte_url, versao),
    }
    r = Resultado()
    with transaction.atomic():
        for codigo, (pessoas, domicilios) in leitura.por_bairro.items():
            bairro = bairros.get(codigo)
            if bairro is None:
                r.sem_casamento_no_arquivo.append(leitura.nomes.get(codigo, codigo))
                continue
            _grava(
                bairro,
                POPULACAO_CENSO,
                valor=pessoas,
                numerador=pessoas,
                denominador=domicilios,
                unidade="pessoas",
                definicao=DEFINICAO_POPULACAO,
                metodo=METODO_POPULACAO,
                **comum,
            )
            if domicilios is not None:
                _grava(
                    bairro,
                    DOMICILIOS_CENSO,
                    valor=domicilios,
                    numerador=domicilios,
                    unidade="domicílios",
                    definicao="Total de domicílios (V0002).",
                    metodo=METODO_POPULACAO,
                    **comum,
                )
            area = areas.get(bairro.pk)
            if area:
                km2 = area / 1_000_000
                _grava(
                    bairro,
                    DENSIDADE,
                    valor=Decimal(str(round(pessoas / km2, 2))),
                    numerador=pessoas,
                    denominador=round(area),
                    unidade="hab/km²",
                    definicao="Habitantes por quilômetro quadrado: população residente do Censo "
                    "÷ área do polígono oficial do bairro.",
                    metodo=METODO_POPULACAO,
                    **comum,
                )
            r.gravados += 1
        r.total_arquivo = sum(p for p, _ in leitura.por_bairro.values())
        r.total_municipal = total_municipal
        if total_municipal is not None:
            r.diferenca = r.total_arquivo - total_municipal
            m = municipio()
            if m is not None:
                _grava(
                    m,
                    CENSO_MUNICIPIO,
                    valor=total_municipal,
                    numerador=total_municipal,
                    unidade="pessoas",
                    definicao="População residente do município no Censo.",
                    metodo="Arquivo 'por município' da mesma revisão do Censo.",
                    **comum,
                )
        r.bairros_sem_dado = sorted(
            b.nome for c, b in bairros.items() if c not in leitura.por_bairro
        )
        r.extras = {"ano": ano, "linhas_invalidas": leitura.invalidas}
        recalcular_estimativas(agora)
    return r


def importar_renda(
    conteudo: bytes,
    *,
    fonte_url: str = URL_CENSO_RENDA,
    ano: int | None = None,
    versao: str | None = None,
    ingerido_em=None,
) -> Resultado:
    leitura = ler_renda(conteudo)
    if not leitura.por_bairro:
        raise FonteInvalida("Nenhum bairro de Fortaleza no arquivo de rendimento.")
    ano = ano or ano_do_censo(fonte_url, 2022)
    agora = ingerido_em or timezone.now()
    bairros = _bairros()
    r = Resultado()
    with transaction.atomic():
        for codigo, (renda, responsaveis) in leitura.por_bairro.items():
            bairro = bairros.get(codigo)
            if bairro is None:
                r.sem_casamento_no_arquivo.append(leitura.nomes.get(codigo, codigo))
                continue
            _grava(
                bairro,
                RENDA,
                valor=renda,
                numerador=responsaveis,
                unidade="R$",
                fonte=f"{ORGAO_IBGE}, Censo Demográfico {ano}, rendimento do responsável",
                fonte_url=fonte_url,
                licenca=LICENCA_IBGE,
                data_referencia=date(ano, 7, 31),
                ingerido_em=agora,
                definicao=DEFINICAO_RENDA,
                metodo=METODO_RENDA,
                versao=_versao(fonte_url, versao),
            )
            r.gravados += 1
        r.bairros_sem_dado = sorted(
            b.nome for c, b in bairros.items() if c not in leitura.por_bairro
        )
        r.extras = {"ano": ano, "sem_valor_no_arquivo": leitura.sem_valor}
    return r


@dataclass
class ResultadoEstimativa:
    populacao: int
    ano: int
    data_referencia: date
    bairros: int = 0


def importar_estimativa(
    conteudo: bytes, *, fonte_url: str, versao: str | None = None, ingerido_em=None
) -> ResultadoEstimativa:
    """Grava a estimativa do município e recalcula a estimativa iTree por bairro."""
    leitura = ler_estimativa(conteudo)
    agora = ingerido_em or timezone.now()
    m = municipio()
    if m is None:
        raise FonteInvalida("Município não cadastrado: importe os limites antes.")
    with transaction.atomic():
        _grava(
            m,
            ESTIMATIVA_MUNICIPIO,
            valor=leitura.populacao,
            numerador=leitura.populacao,
            unidade="pessoas",
            fonte=f"{ORGAO_IBGE}, Estimativas da população {leitura.ano}",
            fonte_url=fonte_url,
            licenca=LICENCA_IBGE,
            data_referencia=leitura.data_referencia,
            ingerido_em=agora,
            versao=_versao(fonte_url, versao),
            definicao="População residente estimada do município em 1º de julho do ano.",
            metodo="Planilha POPAAAA do IBGE, linha do município (2304400).",
        )
        n = recalcular_estimativas(agora)
    return ResultadoEstimativa(leitura.populacao, leitura.ano, leitura.data_referencia, n)


def recalcular_estimativas(agora=None) -> int:
    """Estimativa iTree por bairro = Censo do bairro × (estimativa do município ÷ Censo do
    município). Só roda com os dois insumos; senão remove nada e devolve 0."""
    m = municipio()
    if m is None:
        return 0
    estim = IndicadorTerritorialExterno.objects.filter(
        territorio=m, indicador=ESTIMATIVA_MUNICIPIO
    ).first()
    censo = IndicadorTerritorialExterno.objects.filter(
        territorio=m, indicador=CENSO_MUNICIPIO
    ).first()
    if estim is None or censo is None or not censo.numerador:
        return 0
    razao = Decimal(estim.numerador) / Decimal(censo.numerador)
    n = 0
    for pop in IndicadorTerritorialExterno.objects.filter(
        indicador=POPULACAO_CENSO, territorio__tipo=TipoTerritorio.BAIRRO
    ).select_related("territorio"):
        valor = (Decimal(pop.numerador) * razao).quantize(Decimal("1"))
        _grava(
            pop.territorio,
            POPULACAO_ESTIMADA,
            valor=valor,
            numerador=int(valor),
            denominador=pop.numerador,
            unidade="pessoas",
            fonte=f"Estimativa iTree (não é dado oficial) sobre {estim.fonte} e {pop.fonte}",
            fonte_url=estim.fonte_url,
            licenca=LICENCA_IBGE,
            data_referencia=estim.data_referencia,
            ingerido_em=agora or timezone.now(),
            versao=f"{estim.versao}+{pop.versao}".strip("+"),
            definicao=DEFINICAO_ESTIMATIVA,
            metodo=METODO_ESTIMATIVA,
        )
        n += 1
    return n


def importar_idh(conteudo: bytes, *, fonte_url: str = URL_IDH, ingerido_em=None) -> Resultado:
    leitura = ler_idh(conteudo)
    agora = ingerido_em or timezone.now()
    bairros = list(Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO))
    indice = IndiceBairros.de(bairros)
    for apelido, oficial in APELIDOS_IDH.items():
        achado = next((b for b in bairros if b.nome == oficial), None)
        if achado:
            indice.por_nome.setdefault(apelido, achado)
    r = Resultado()
    casados: set[int] = set()
    comum = {
        "fonte": FONTE_IDH_TEXTO,
        "fonte_url": fonte_url,
        "licenca": LICENCA_IDH,
        "data_referencia": date(leitura.ano, 12, 31),
        "ingerido_em": agora,
        "versao": leitura.versao,
        "definicao": DEFINICAO_IDH,
        "metodo": METODO_IDH,
        "unidade": "IDH",
    }
    # Dois bairros de 2010 que hoje são um só (Boa Vista e Castelão) disputam o mesmo bairro:
    # nenhum dos dois vale, pois o IDH de um não é o do conjunto.
    alvos = [indice.procurar(reg["nome"]) for reg in leitura.registros]
    repetidos = {a.pk for a in alvos if isinstance(a, Territorio)}
    repetidos = {
        pk for pk in repetidos if sum(1 for a in alvos if getattr(a, "pk", None) == pk) > 1
    }
    with transaction.atomic():
        for reg, bairro in zip(leitura.registros, alvos, strict=True):
            if not isinstance(bairro, Territorio) or bairro.pk in repetidos:
                r.sem_casamento_no_arquivo.append(reg["nome"])
                continue
            casados.add(bairro.pk)
            for indicador, chave in (
                (IDH, "idh"),
                (IDH_EDUCACAO, "educacao"),
                (IDH_LONGEVIDADE, "longevidade"),
                (IDH_RENDA, "renda"),
            ):
                valor = Decimal(str(reg[chave])).quantize(Decimal("0.0001"))
                # O indicador guarda o IDH como fração de 10.000 para somar sem perder a escala.
                _grava(
                    bairro,
                    indicador,
                    valor=valor,
                    numerador=int(valor * 10000),
                    denominador=10000,
                    **comum,
                )
            r.gravados += 1
        # Sem valor antigo de bairro que a fonte deixou de listar.
        IndicadorTerritorialExterno.objects.filter(
            indicador__in=[IDH, IDH_EDUCACAO, IDH_LONGEVIDADE, IDH_RENDA]
        ).exclude(territorio_id__in=casados).delete()
    r.bairros_sem_dado = sorted(b.nome for b in bairros if b.pk not in casados)
    r.extras = {"ano": leitura.ano, "versao": leitura.versao}
    return r


# --- Execuções e renovação -----------------------------------------------------------------------


def registrar_execucao(fonte: str, *, origem: str = "manual", **campos) -> ExecucaoFonteExterna:
    agora = timezone.now()
    return ExecucaoFonteExterna.objects.create(
        fonte=fonte, origem=origem, iniciada_em=agora, concluida_em=agora, **campos
    )


def ultima_versao(fonte: str) -> str:
    e = ExecucaoFonteExterna.objects.filter(fonte=fonte, sucesso=True, importou=True).first()
    return e.versao if e else ""


def executar(
    fonte: str, origem: str, versao: str, ano: int | None, importar, propagar: bool = False
) -> dict:
    """Importa e registra a execução. A falha é registrada; sobe só com ``propagar``."""
    try:
        resultado = importar()
    except Exception as exc:  # noqa: BLE001
        registrar_execucao(
            fonte,
            origem=origem,
            sucesso=False,
            versao=versao,
            ano_referencia=ano,
            erro=str(exc)[:1000],
        )
        if propagar:
            raise
        return {"fonte": fonte, "situacao": "falha", "erro": str(exc), "versao": versao}
    if isinstance(resultado, Resultado):
        resumo = resultado.resumo()
    else:
        resumo = {
            "populacao_municipio": resultado.populacao,
            "bairros": resultado.bairros,
            "data_referencia": resultado.data_referencia.isoformat(),
        }
    registrar_execucao(
        fonte,
        origem=origem,
        sucesso=True,
        importou=True,
        versao=versao,
        ano_referencia=ano,
        resumo=resumo,
    )
    return {"fonte": fonte, "situacao": "importado", "versao": versao, "resumo": resumo}


def _sem_novidade(fonte: str, origem: str, versao: str) -> dict:
    registrar_execucao(fonte, origem=origem, sucesso=True, importou=False, versao=versao)
    return {"fonte": fonte, "situacao": "sem_novidade", "versao": versao}


def renovar(origem: str = "agendada", baixar_arquivo=baixar, listar=listar_diretorio) -> list[dict]:
    """Confere as quatro fontes e reimporta as que mudaram (ano ou versão novos). Cada fonte é
    independente: a falha de uma é registrada e não impede as outras. Devolve um resumo por
    fonte."""
    saida = []

    def passo(fonte, descobrir, conteudo_e_versao, importar, ano=None):
        try:
            url = descobrir()
            if not url:
                raise FonteInvalida("Arquivo não encontrado na listagem do diretório.")
            versao = _versao_do_nome(url)
            if versao and versao == ultima_versao(fonte):
                saida.append(_sem_novidade(fonte, origem, versao))
                return
            saida.append(
                executar(fonte, origem, versao, ano_do_censo(url, ano), lambda: importar(url))
            )
        except Exception as exc:  # noqa: BLE001
            registrar_execucao(fonte, origem=origem, sucesso=False, erro=str(exc)[:1000])
            saida.append({"fonte": fonte, "situacao": "falha", "erro": str(exc)})

    def censo(url):
        total = None
        try:
            total = ler_total_municipio(baixar_arquivo(url_do_municipio(url)))
        except Exception:  # noqa: BLE001
            total = None  # sem o total municipal não há conferência, mas a importação segue
        return importar_populacao_censo(baixar_arquivo(url), fonte_url=url, total_municipal=total)

    passo(FONTE_CENSO_POPULACAO, lambda: descobrir_basico(listar), None, censo)
    passo(
        FONTE_CENSO_RENDA,
        lambda: descobrir_renda(listar),
        None,
        lambda url: importar_renda(baixar_arquivo(url), fonte_url=url),
    )
    passo(
        FONTE_ESTIMATIVA,
        lambda: descobrir_estimativa(listar),
        None,
        lambda url: importar_estimativa(baixar_arquivo(url), fonte_url=url),
    )
    _passo_idh(saida, origem, baixar_arquivo)
    return saida


def _passo_idh(saida: list, origem: str, baixar_arquivo) -> None:
    """O IDH não tem versão no nome: a versão é o hash do conteúdo. Mudou o hash, reimporta."""
    try:
        conteudo = baixar_arquivo(URL_IDH)
        versao = ler_idh(conteudo).versao
        if versao == ultima_versao(FONTE_IDH):
            saida.append(_sem_novidade(FONTE_IDH, origem, versao))
            return
        saida.append(executar(FONTE_IDH, origem, versao, 2010, lambda: importar_idh(conteudo)))
    except Exception as exc:  # noqa: BLE001
        registrar_execucao(FONTE_IDH, origem=origem, sucesso=False, erro=str(exc)[:1000])
        saida.append({"fonte": FONTE_IDH, "situacao": "falha", "erro": str(exc)})
