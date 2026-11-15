"""Leitura das planilhas em formato de ficha da URBFOR: doação de mudas (PF e PJ) e plantio.

As três planilhas do dataset ``doacao-mudas-pf`` (CKAN de Fortaleza, URBFOR, 2022) têm o mesmo
desenho: a primeira aba é uma pilha de fichas, uma por atendimento. Conferido com os arquivos
reais em 2026-11-15:

- uma linha de título do mês ("JANEIRO - 2022", "Junho- 2022", "JUlHO- 2022") antes das fichas
  do mês; "RETORNO FÉRIAS" e outros textos soltos na coluna A são ignorados;
- a ficha começa em "REQUERENTE:" (doação) ou "DATA:" (plantio), na coluna E, com o valor na F;
  depois vêm "DATA:", "ENDEREÇO:" e, no plantio, "LOCAL:", e uma linha de cabeçalho
  (ORNAMENTAL, NATIVA/FRUTÍFERA, PALMEIRA, MEDICINAL, ESPÉCIE, QUANTIDADE);
- cada espécie é uma linha com o nome na coluna E e a quantidade na F; a categoria é a coluna
  (A a D) em que o nome se repete, e fica vazia em parte das linhas (então vale a lista
  auxiliar da própria planilha, ou nada);
- a ficha termina na linha "TOTAL" (ou "total:"); "TOTAL DE MUDAS DOADAS" é o total do mês;
- as colunas H a M têm tabelas soltas de resumo (com "#REF!"): são ignoradas.

**O nome do requerente nunca é lido para fora desta função**: na doação a pessoa física
informa o próprio nome. A ficha só carrega o que não é pessoal.
"""

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime

CATEGORIAS = {
    0: "ornamental",
    1: "nativa_frutifera",
    2: "palmeira",
    3: "medicinal",
}
# Nome da aba auxiliar (lista de nomes) de cada categoria.
ABAS_AUXILIARES = {
    "ornamentais": "ornamental",
    "nativas e frutiferas": "nativa_frutifera",
    "palmeiras": "palmeira",
    "medicinal": "medicinal",
}
MESES = {
    "jan": 1,
    "fev": 2,
    "mar": 3,
    "abr": 4,
    "mai": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "set": 9,
    "out": 10,
    "nov": 11,
    "dez": 12,
}


def simples(texto) -> str:
    sem = unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", sem).strip()


ESPECIE_NAO_INFORMADA = "Espécie não informada"


@dataclass
class Item:
    especie: str
    quantidade: int
    categoria: str  # "" quando a planilha não diz
    linha: int
    categoria_via: str = ""  # "planilha" (coluna da linha) ou "lista_auxiliar" (aba de nomes)


@dataclass
class Ficha:
    linha: int
    ano: int | None  # ano do título do mês
    mes: int | None  # mês do título
    data: date | None = None
    data_fim: date | None = None  # só nas fichas que informam um período
    endereco: str = ""
    local: str = ""
    itens: list[Item] = field(default_factory=list)
    total_declarado: int | None = None

    @property
    def total(self) -> int:
        return sum(i.quantidade for i in self.itens)


@dataclass
class LeituraFichas:
    fichas: list[Ficha] = field(default_factory=list)
    # Ocorrências que não foram entendidas: (linha, motivo, texto).
    nao_entendidas: list[tuple[int, str, str]] = field(default_factory=list)
    total_do_mes_declarado: int = 0  # soma das linhas "TOTAL DE MUDAS DOADAS"

    @property
    def total(self) -> int:
        return sum(f.total for f in self.fichas)

    @property
    def total_declarado(self) -> int:
        return sum(f.total_declarado or 0 for f in self.fichas)


def _inteiro(valor) -> int | None:
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int | float):
        return int(valor) if float(valor) == int(valor) and valor >= 0 else None
    texto = str(valor or "").strip().replace(".", "")
    return int(texto) if texto.isdigit() else None


def _data(valor) -> date | None:
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    achado = re.fullmatch(r"\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s*", str(valor or ""))
    if not achado:
        return None
    dia, mes, ano = (int(g) for g in achado.groups())
    ano += 2000 if ano < 100 else 0
    try:
        return date(ano, mes, dia)
    except ValueError:
        return None


def _titulo_do_mes(texto) -> tuple[int, int] | None:
    achado = re.fullmatch(r"\s*([A-Za-zÀ-ÿ]+)\s*-\s*(\d{4})\s*", str(texto or ""))
    if not achado:
        return None
    mes = MESES.get(simples(achado.group(1))[:3])
    return (int(achado.group(2)), mes) if mes else None


def _texto(valor) -> str:
    return re.sub(r"\s+", " ", str(valor or "")).strip()


def ler_fichas(linhas: list[tuple], auxiliares: dict[str, str] | None = None) -> LeituraFichas:
    """Interpreta as linhas da primeira aba. ``auxiliares`` mapeia o nome simples de uma espécie
    à categoria da lista auxiliar, e vale só onde a linha não traz categoria."""
    auxiliares = auxiliares or {}
    leitura = LeituraFichas()
    ano = mes = None
    ficha: Ficha | None = None
    for numero, bruta in enumerate(linhas, start=1):
        c = [*bruta[:7], *([None] * 7)]
        if all(v is None or str(v).strip() == "" for v in c[:7]):
            continue
        rotulo = simples(c[4]) if isinstance(c[4], str) else ""
        titulo = _titulo_do_mes(c[0]) if isinstance(c[0], str) and not rotulo else None
        if titulo:
            ano, mes = titulo
            ficha = None
            continue
        if rotulo == "especie" or (isinstance(c[0], str) and simples(c[0]) == "ornamental"):
            continue  # cabeçalho, repetido a cada ficha
        if rotulo.startswith("requerente"):
            ficha = Ficha(numero, ano, mes)
            leitura.fichas.append(ficha)  # o valor da coluna F (nome) é descartado aqui
        elif rotulo.startswith("data"):
            if ficha is None or ficha.data is not None or ficha.itens:
                ficha = Ficha(numero, ano, mes)
                leitura.fichas.append(ficha)
            ficha.data = _data(c[5])
            periodo = re.fullmatch(r"\s*(\S+)\s*-\s*(\S+)\s*", str(c[5] or ""))
            if ficha.data is None and periodo and (_data(periodo[1]) and _data(periodo[2])):
                ficha.data, ficha.data_fim = _data(periodo[1]), _data(periodo[2])
            if ficha.data is None and c[5] not in (None, ""):
                leitura.nao_entendidas.append((numero, "data ilegível", _texto(c[5])))
        elif rotulo == "total de mudas doadas":
            leitura.total_do_mes_declarado += _inteiro(c[5]) or 0
        elif ficha is None and rotulo.startswith("total"):
            continue  # total repetido depois de fechar a ficha
        elif ficha is None:
            # Antes da primeira ficha só pode haver título ou texto solto.
            if isinstance(c[0], str) and c[0].strip() and rotulo == "":
                continue
            leitura.nao_entendidas.append((numero, "linha fora de uma ficha", _texto(c[4] or c[0])))
        elif rotulo.startswith("endereco"):
            ficha.endereco = _texto(c[5])
        elif rotulo.startswith("local"):
            ficha.local = _texto(c[5])
        elif rotulo.startswith("total"):
            ficha.total_declarado = _inteiro(c[5])
            ficha = None
        elif not rotulo and _inteiro(c[5]) is not None and not any(_texto(c[i]) for i in range(4)):
            # Em algumas fichas o total vem numa linha sem o rótulo "TOTAL" (e se repete depois).
            ficha.total_declarado = _inteiro(c[5])
        elif rotulo:
            quantidade = _inteiro(c[5])
            if quantidade is None:
                leitura.nao_entendidas.append(
                    (numero, "quantidade ausente ou inválida", _texto(c[4]))
                )
                continue
            categorias = [CATEGORIAS[i] for i in range(4) if _texto(c[i])]
            if len(categorias) > 1:
                # A linha traz outros nomes nas colunas de categoria: vale a coluna do próprio nome.
                categorias = [CATEGORIAS[i] for i in range(4) if simples(c[i]) == simples(c[4])]
            categoria = categorias[0] if len(categorias) == 1 else ""
            if _texto(c[0]) + _texto(c[1]) + _texto(c[2]) + _texto(c[3]) and not categoria:
                leitura.nao_entendidas.append((numero, "categoria ambígua na linha", _texto(c[4])))
            via = "planilha" if categoria else ""
            if not categoria and (categoria := auxiliares.get(simples(c[4]), "")):
                via = "lista_auxiliar"
            if quantidade == 0:
                continue
            ficha.itens.append(Item(_texto(c[4]), quantidade, categoria, numero, via))
        else:
            leitura.nao_entendidas.append((numero, "linha não reconhecida", _texto(c[0])))
    for f in leitura.fichas:
        if not f.itens and f.total_declarado:
            # Total informado sem nenhuma espécie: as mudas existem, a espécie não foi anotada.
            f.itens.append(Item(ESPECIE_NAO_INFORMADA, f.total_declarado, "", f.linha))
    return leitura


def lista_auxiliar(abas: dict[str, list[tuple]]) -> dict[str, str]:
    """Nome simples da espécie -> categoria, a partir das abas auxiliares da planilha
    ("Ornamentais", "Nativas e Frutíferas", "Palmeiras", "Medicinal"), uma lista de nomes por aba.
    Nome que aparece em duas listas fica de fora: não dá para escolher."""
    por_nome: dict[str, set[str]] = {}
    for nome_aba, linhas in abas.items():
        categoria = ABAS_AUXILIARES.get(simples(nome_aba))
        if not categoria:
            continue
        for linha in linhas:
            if linha and isinstance(linha[0], str) and linha[0].strip():
                por_nome.setdefault(simples(linha[0]), set()).add(categoria)
    return {n: next(iter(c)) for n, c in por_nome.items() if len(c) == 1}


def ler_planilha(abas: dict[str, list[tuple]]) -> LeituraFichas:
    """As fichas da primeira aba, com a lista auxiliar das demais."""
    primeira = next(iter(abas.values()))
    return ler_fichas(primeira, lista_auxiliar(abas))
