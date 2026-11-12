"""Conferência das unidades de conservação com o CNUC (MMA, licença CC BY).

O Cadastro Nacional de Unidades de Conservação publica uma tabela CSV
(``cnuc_AAAA_MM.csv``, ISO-8859-1, separada por ``;``) em ``dados.mma.gov.br``.
As unidades do Fortaleza em Mapas (mapa 737) casam com ela pelo **nome
normalizado**: sem acento nem caixa, sem pontuação nem artigos, com as siglas
APA e ARIE por extenso e sem o sufixo de zona de uma unidade dividida
("- ZA", "- ZP", "- ZC"). Só entram as unidades da UF pedida (padrão CE), porque
há nomes de outros estados parecidos (APA da Fortaleza de Santa Cruz, no RJ).

Quem casa recebe o código do CNUC e a esfera do CNUC. A esfera da fonte da
prefeitura não é trocada: a divergência entre as duas vai para o relatório.
"""

import csv
import io
import re
import unicodedata
from dataclasses import dataclass, field

# Nome real das colunas do CSV do CNUC (2026-07).
COL_CODIGO = "Código UC"
COL_NOME = "Nome da UC"
COL_ESFERA = "Esfera Administrativa"
COL_CATEGORIA = "Categoria de Manejo"
COL_UF = "UF"
COL_MUNICIPIOS = "Municípios Abrangidos"
COLUNAS = (COL_CODIGO, COL_NOME, COL_ESFERA, COL_UF, COL_MUNICIPIOS)

SIGLAS = {
    "apa": "area protecao ambiental",
    "arie": "area relevante interesse ecologico",
}
ARTIGOS = {"de", "da", "do", "das", "dos", "e"}
ZONA = re.compile(r"\s+-\s+z[a-z]{1,2}\s*$", re.IGNORECASE)


class CnucInvalido(ValueError):
    """O arquivo não tem as colunas do CSV do CNUC."""


def _sem_acento(texto: str) -> str:
    return unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().casefold()


def chave_da_uc(nome: str) -> str:
    """Nome normalizado de uma unidade de conservação (ver o módulo)."""
    nome = ZONA.sub("", nome or "")
    texto = _sem_acento(nome)
    palavras = []
    for palavra in re.findall(r"[a-z0-9]+", texto):
        if palavra in ARTIGOS:
            continue
        palavras.append(SIGLAS.get(palavra, palavra))
    return " ".join(palavras)


@dataclass(frozen=True)
class UcCnuc:
    codigo: str
    nome: str
    esfera: str
    categoria: str
    municipios: str


def ler_cnuc(conteudo: bytes, uf: str = "CE") -> list[UcCnuc]:
    """Unidades da ``uf`` no CSV do CNUC (ISO-8859-1)."""
    leitor = csv.DictReader(io.StringIO(conteudo.decode("iso-8859-1")), delimiter=";")
    ausentes = [c for c in COLUNAS if c not in (leitor.fieldnames or [])]
    if ausentes:
        raise CnucInvalido("Colunas ausentes no CSV do CNUC: " + ", ".join(ausentes))
    return [
        UcCnuc(
            codigo=linha[COL_CODIGO].strip(),
            nome=" ".join(linha[COL_NOME].split()),
            esfera=linha[COL_ESFERA].strip(),
            categoria=(linha.get(COL_CATEGORIA) or "").strip(),
            municipios=linha[COL_MUNICIPIOS].strip(),
        )
        for linha in leitor
        if linha[COL_UF].strip().upper() == uf.upper() and linha[COL_CODIGO].strip()
    ]


@dataclass
class Conferencia:
    """Resultado do cruzamento entre as unidades do mapa e as do CNUC."""

    # nome na fonte da prefeitura -> (unidade do CNUC, quantidade de feições)
    casadas: dict[str, tuple[UcCnuc, int]] = field(default_factory=dict)
    nao_casadas: dict[str, int] = field(default_factory=dict)
    ambiguas: dict[str, list[str]] = field(default_factory=dict)
    divergencias_de_esfera: list[str] = field(default_factory=list)
    so_no_cnuc: list[UcCnuc] = field(default_factory=list)


def conferir(areas, ucs: list[UcCnuc], municipio: str = "Fortaleza") -> Conferencia:
    """Casa as ``areas`` (unidades de conservação do mapa) com as do CNUC pelo nome normalizado.

    Devolve também as unidades do CNUC que abrangem ``municipio`` e não casaram com nenhuma
    área do mapa. Não grava nada."""
    por_chave: dict[str, list[UcCnuc]] = {}
    for uc in ucs:
        por_chave.setdefault(chave_da_uc(uc.nome), []).append(uc)
    resultado = Conferencia()
    usadas: set[str] = set()
    for area in areas:
        chave = chave_da_uc(area.nome)
        candidatas = por_chave.get(chave, [])
        if len(candidatas) == 1:
            uc = candidatas[0]
            usadas.add(uc.codigo)
            casada, n = resultado.casadas.get(area.nome, (uc, 0))
            resultado.casadas[area.nome] = (casada, n + 1)
            if area.esfera and uc.esfera and area.esfera.casefold() != uc.esfera.casefold():
                resultado.divergencias_de_esfera.append(
                    f"{area.nome}: mapa {area.esfera}, CNUC {uc.esfera}"
                )
        elif candidatas:
            resultado.ambiguas[area.nome] = sorted(u.codigo for u in candidatas)
        else:
            resultado.nao_casadas[area.nome] = resultado.nao_casadas.get(area.nome, 0) + 1
    resultado.divergencias_de_esfera = sorted(set(resultado.divergencias_de_esfera))
    alvo = _sem_acento(municipio)
    resultado.so_no_cnuc = [
        uc for uc in ucs if uc.codigo not in usadas and alvo in _sem_acento(uc.municipios)
    ]
    return resultado
