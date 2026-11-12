"""Manejo de árvores registrado pela URBFOR, por bairro e mês (F-04, parte segura).

Fonte: dataset ``podas_recolhimento_supressao`` do portal de dados abertos de Fortaleza
(Autarquia de Urbanismo e Paisagismo, URBFOR): uma planilha CSV por mês de 2023
(ISO-8859-1, separada por ``;``; setembro não foi publicado). Cada linha é um serviço, com
data, descrição em texto livre, regional ("SER 01", "SER 8"...), porte e as contagens de
poda, supressão e recolhimento. **Não há coordenadas**: nada é geocodificado e nada entra
no inventário de árvores.

Regras de leitura (conferidas com os 11 arquivos reais, cujas somas batem com a linha
"TOTAL" de cada planilha):

- Linha de serviço é a que começa com uma data (dígitos e barras, nos formatos reais
  "04/01/2023", "19/05/23", "0412/2023" e "27/1//2023"). Linhas de total, cabeçalhos
  repetidos e colunas soltas depois da sétima são ignorados.
- O mês é o do arquivo (título "JANEIRO (2023)"), não o da data da linha, que tem erros de
  digitação (quatro linhas de junho trazem data de julho).
- As quantidades são as colunas Poda, Supressão e Recolhimento. O texto da descrição só serve
  para achar o bairro.
- O bairro vem do fim de cada trecho da descrição ("... na Rua X - Bairro" ou "..., Bairro.").
  A linha só é atribuída a um bairro quando todos os trechos apontam para o mesmo bairro
  cadastrado, comparado sem acento nem caixa, com um conjunto pequeno de variações de grafia
  (``APELIDOS``). Se a regional da linha ("SER n", mesma numeração do Fortaleza em Mapas)
  difere da regional do bairro cadastrado, vale o bairro e o relatório conta a divergência.
  Nome que serve a dois bairros (Praia do Futuro I e II, Conjunto Ceará I e II)
  é ambíguo, e o que não se reconhece fica "sem bairro identificado". Esses totais são
  gravados à parte, no município, para a soma não perder nada.
"""

import csv
import io
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from itree.territorio.models import Territorio, TipoTerritorio
from itree.territorio.regionais import numero_da_regional

from .models import IndicadorTerritorialExterno

DATASET = "podas_recolhimento_supressao"
API_CKAN = "https://dados.fortaleza.ce.gov.br/api/3/action/package_show"
FONTE = "URBFOR (Autarquia de Urbanismo e Paisagismo de Fortaleza)"
FONTE_URL = f"https://dados.fortaleza.ce.gov.br/dataset/{DATASET}"
# A licença não consta no CKAN (campo vazio); a decisão sobre o responsável está em DP-10.
LICENCA = "não declarada (DP-10)"
ANO = 2023

PREFIXO = "manejo_urbfor_"
ACOES = {"poda": "Poda", "supressao": "Supressão", "recolhimento": "Recolhimento"}
NOME_ANALISE = "Manejo registrado pela URBFOR (2023)"

DEFINICAO_ACAO = {
    "poda": "Árvores podadas, segundo a coluna Poda da planilha mensal da URBFOR.",
    "supressao": "Árvores suprimidas (cortadas), segundo a coluna Supressão da planilha da URBFOR.",
    "recolhimento": (
        "Árvores caídas ou podadas cujo material foi recolhido, segundo a coluna "
        "Recolhimento da planilha da URBFOR."
    ),
}
METODO = (
    "Soma das quantidades informadas nas planilhas mensais da URBFOR (dados abertos de "
    "Fortaleza, 2023), por bairro e mês. O bairro foi lido do texto livre da descrição, sem "
    "coordenadas e sem geocodificação; serviços cujo bairro não foi reconhecido ou serve a dois "
    'bairros ficam em "sem bairro identificado" (município). Os números não foram conferidos '
    "em campo e não entram no inventário de árvores."
)

MESES = {
    "janeiro": 1,
    "fevereiro": 2,
    "marco": 3,
    "abril": 4,
    "maio": 5,
    "junho": 6,
    "julho": 7,
    "agosto": 8,
    "setembro": 9,
    "outubro": 10,
    "novembro": 11,
    "dezembro": 12,
}

# Grafias da URBFOR que não são o nome oficial do bairro (mapa 21, Fortaleza em Mapas).
# Só entram equivalências claras; erros de digitação soltos ficam sem bairro identificado.
APELIDOS = {
    "jose walter": "Prefeito José Walter",
    "pref jose walter": "Prefeito José Walter",
    "luciano cavalcante": "Engenheiro Luciano Cavalcante",
    "sao joao do tauape": "Tauape",
    "manoel dias branco": "Manuel Dias Branco",
    "vicente pizon": "Vicente Pinzón",
    "manuel satiro": "Manoel Sátiro",
    "vila manuel satiro": "Manoel Sátiro",
    "vila manoel satiro": "Manoel Sátiro",
    "joquei club": "Jóquei Clube",
    "joquei": "Jóquei Clube",
    "lourdes": "De Lourdes",
    "bom sucesso": "Bonsucesso",
}

NAO_IDENTIFICADO = "nao_identificado"
AMBIGUO = "ambiguo"


class ManejoInvalido(ValueError):
    """O arquivo não tem o formato das planilhas mensais da URBFOR."""


def _simples(texto: str) -> str:
    sem = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", sem).strip()


# --- Leitura dos CSVs ---------------------------------------------------------


@dataclass
class Servico:
    regional: int | None
    quantidades: dict[str, int]
    descricao: str
    data_fora_do_mes: bool = False


@dataclass
class LeituraMes:
    ano: int
    mes: int
    servicos: list[Servico] = field(default_factory=list)
    total_declarado: dict[str, int] | None = None

    @property
    def total_lido(self) -> dict[str, int]:
        return {a: sum(s.quantidades[a] for s in self.servicos) for a in ACOES}


def _inteiro(texto: str) -> int:
    texto = texto.strip()
    return int(texto) if re.fullmatch(r"\d+", texto) else 0


def _quantidades(colunas: list[str]) -> dict[str, int]:
    """Poda, supressão e recolhimento das colunas 5 a 7 da planilha."""
    return {
        "poda": _inteiro(colunas[4]),
        "supressao": _inteiro(colunas[5]),
        "recolhimento": _inteiro(colunas[6]),
    }


def _mes_do_titulo(titulo: str) -> tuple[int, int]:
    """ "JANEIRO (2023)" -> (2023, 1)."""
    achado = re.match(r"\s*([A-Za-zÀ-ÿ]+)\s*\(\s*(\d{4})\s*\)", titulo)
    mes = MESES.get(_simples(achado.group(1))) if achado else None
    if not achado or mes is None:
        raise ManejoInvalido(f"Título de planilha desconhecido: {titulo!r}.")
    return int(achado.group(2)), mes


def _mes_da_data(texto: str) -> int | None:
    achado = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", texto.strip())
    return int(achado.group(2)) if achado else None


def ler_mes(conteudo: bytes) -> LeituraMes:
    """Lê uma planilha mensal (ISO-8859-1, ``;``). Ver as regras no módulo."""
    linhas = list(csv.reader(io.StringIO(conteudo.decode("iso-8859-1")), delimiter=";"))
    if len(linhas) < 3 or "descri" not in _simples(" ".join(linhas[1][:3])):
        raise ManejoInvalido("Cabeçalho esperado (DATA; DESCRIÇÃO; Regional...) não encontrado.")
    ano, mes = _mes_do_titulo(linhas[0][0])
    leitura = LeituraMes(ano, mes)
    for linha in linhas[2:]:
        c = (linha + [""] * 7)[:7]
        if re.fullmatch(r"\d[\d/]*", c[0].strip()):
            leitura.servicos.append(
                Servico(
                    regional=numero_da_regional(c[2]),
                    quantidades=_quantidades(c),
                    descricao=c[1],
                    data_fora_do_mes=_mes_da_data(c[0]) not in (None, mes),
                )
            )
        elif not c[0].strip() and not c[1].strip() and re.fullmatch(r"\d+", c[4].strip()):
            # Linha de total ("TOTAL" na quarta coluna, ou sem rótulo).
            leitura.total_declarado = _quantidades(c)
    return leitura


# --- Bairro pelo texto da descrição --------------------------------------------


@dataclass
class IndiceBairros:
    """Nomes normalizados dos bairros cadastrados, com os apelidos e as ambiguidades."""

    por_nome: dict[str, Territorio] = field(default_factory=dict)
    ambiguos: set[str] = field(default_factory=set)

    @classmethod
    def de(cls, bairros) -> "IndiceBairros":
        indice = cls()
        oficiais = {b.nome: b for b in bairros}
        for bairro in oficiais.values():
            indice.por_nome[_simples(bairro.nome)] = bairro
            for parte in bairro.nome.split(" / "):  # "Boa Vista / Castelão"
                indice.por_nome.setdefault(_simples(parte), bairro)
            base = re.sub(r"\s+(I|II)$", "", bairro.nome)  # "Praia do Futuro I" e "II"
            if base != bairro.nome:
                indice.ambiguos.add(_simples(base))
        for apelido, oficial in APELIDOS.items():
            if oficial in oficiais:
                indice.por_nome[apelido] = oficiais[oficial]
        return indice

    def procurar(self, texto: str) -> Territorio | str:
        """Bairro cadastrado, ou ``AMBIGUO`` / ``NAO_IDENTIFICADO``."""
        chave = _simples(re.sub(r"^\s*bairro\s+", "", texto, flags=re.IGNORECASE))
        chave = re.sub(r"^conj ", "conjunto ", chave)  # "Conj. Ceará", "Conj. Palmeiras"
        if chave in self.por_nome:
            return self.por_nome[chave]
        return AMBIGUO if chave in self.ambiguos else NAO_IDENTIFICADO


def _finais_dos_trechos(descricao: str) -> list[str | None]:
    """Fim de cada trecho da descrição: o texto depois do último " - " ou da última vírgula.

    Os trechos se separam por quebra de linha ou por três espaços ou mais; " + " liga duas ações
    no mesmo lugar e não separa trechos."""
    finais = []
    for trecho in re.split(r"\n|\s{3,}", descricao):
        trecho = trecho.strip().rstrip(". ;")
        if not trecho:
            continue
        if " - " in trecho:
            final = trecho.rsplit(" - ", 1)[1]
        elif "," in trecho:
            final = trecho.rsplit(",", 1)[1]
        else:
            finais.append(None)
            continue
        finais.append(re.sub(r"\s*\(.*?\)\s*$", "", final.strip().rstrip(". ")))
    return finais


def bairro_do_servico(descricao: str, indice: IndiceBairros) -> Territorio | str:
    """O bairro do serviço, se todos os trechos da descrição apontam para o mesmo."""
    achados = [
        indice.procurar(f) if f else NAO_IDENTIFICADO for f in _finais_dos_trechos(descricao)
    ]
    if not achados:
        return NAO_IDENTIFICADO
    if any(a == AMBIGUO for a in achados):
        return AMBIGUO
    if any(a == NAO_IDENTIFICADO for a in achados):
        return NAO_IDENTIFICADO
    return achados[0] if len({a.pk for a in achados}) == 1 else NAO_IDENTIFICADO


# --- Indicadores -----------------------------------------------------------------


def id_indicador(acao: str, ano: int, mes: int, *, sem_bairro: bool = False) -> str:
    meio = "sem_bairro_" if sem_bairro else ""
    return f"{PREFIXO}{meio}{acao}_{ano}{mes:02d}"


def interpretar_indicador(indicador: str) -> tuple[str, int, int, bool] | None:
    """ "manejo_urbfor_poda_202301" -> ("poda", 2023, 1, False); outro id, ``None``."""
    achado = re.fullmatch(rf"{PREFIXO}(sem_bairro_)?([a-z]+)_(\d{{4}})(\d{{2}})", indicador)
    if not achado or achado.group(2) not in ACOES:
        return None
    return achado.group(2), int(achado.group(3)), int(achado.group(4)), bool(achado.group(1))


@dataclass
class ResultadoMes:
    ano: int
    mes: int
    servicos: int
    totais: dict[str, int]
    identificado: dict[str, int]
    ambiguo: dict[str, int]
    nao_identificado: dict[str, int]
    total_declarado: dict[str, int] | None
    datas_fora_do_mes: int
    # Árvores de serviços cuja regional ("SER n") difere da regional do bairro cadastrado.
    regional_divergente: int = 0
    textos_nao_reconhecidos: Counter = field(default_factory=Counter)


@dataclass
class ResultadoImportacao:
    meses: list[ResultadoMes] = field(default_factory=list)
    gravados: int = 0

    def soma(self, campo: str) -> int:
        return sum(sum(getattr(m, campo).values()) for m in self.meses)


def importar(arquivos: list[bytes], *, ingerido_em=None) -> ResultadoImportacao:
    """Agrega as planilhas por bairro e mês e grava ``IndicadorTerritorialExterno``.

    Idempotente: para cada mês presente nos arquivos, apaga e regrava as linhas do mês. Exige os
    bairros e o município cadastrados (``importar_limites_fortaleza``)."""
    bairros = list(Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO).select_related("pai"))
    municipio = Territorio.objects.filter(tipo=TipoTerritorio.MUNICIPIO).first()
    if not bairros or municipio is None:
        raise ManejoInvalido(
            "Cadastre o município e os bairros antes (manage.py importar_limites_fortaleza)."
        )
    indice = IndiceBairros.de(bairros)
    agora = ingerido_em or timezone.now()
    resultado = ResultadoImportacao()
    novos: list[IndicadorTerritorialExterno] = []
    ids_dos_meses: list[str] = []
    for conteudo in arquivos:
        leitura = ler_mes(conteudo)
        por_bairro: dict[tuple[int, str], int] = {}
        grupos = {k: dict.fromkeys(ACOES, 0) for k in (None, AMBIGUO, NAO_IDENTIFICADO)}
        mes = ResultadoMes(
            leitura.ano,
            leitura.mes,
            len(leitura.servicos),
            leitura.total_lido,
            grupos[None],
            grupos[AMBIGUO],
            grupos[NAO_IDENTIFICADO],
            leitura.total_declarado,
            sum(s.data_fora_do_mes for s in leitura.servicos),
        )
        for servico in leitura.servicos:
            achado = bairro_do_servico(servico.descricao, indice)
            grupo = grupos[None if isinstance(achado, Territorio) else achado]
            if (
                isinstance(achado, Territorio)
                and servico.regional
                and achado.pai is not None
                and achado.pai.codigo != str(servico.regional)
            ):
                mes.regional_divergente += sum(servico.quantidades.values())
            for acao, n in servico.quantidades.items():
                grupo[acao] += n
                if isinstance(achado, Territorio):
                    por_bairro[(achado.pk, acao)] = por_bairro.get((achado.pk, acao), 0) + n
            if achado == NAO_IDENTIFICADO and any(servico.quantidades.values()):
                final = next(iter(reversed(_finais_dos_trechos(servico.descricao))), None)
                mes.textos_nao_reconhecidos[final or "(sem bairro no texto)"] += sum(
                    servico.quantidades.values()
                )
        resultado.meses.append(mes)
        data_ref = _ultimo_dia(leitura.ano, leitura.mes)

        def linha(territorio, acao, quantidade, sem_bairro, leitura=leitura, data_ref=data_ref):
            return IndicadorTerritorialExterno(
                territorio=territorio,
                indicador=id_indicador(acao, leitura.ano, leitura.mes, sem_bairro=sem_bairro),
                valor=Decimal(quantidade),
                numerador=quantidade,
                denominador=None,
                unidade="árvores",
                fonte=FONTE,
                fonte_url=FONTE_URL,
                licenca=LICENCA,
                data_referencia=data_ref,
                ingerido_em=agora,
                definicao=DEFINICAO_ACAO[acao]
                + (" Serviços sem bairro reconhecido, somados no município." if sem_bairro else ""),
                metodo=METODO,
            )

        por_id = {b.pk: b for b in bairros}
        for (pk, acao), n in sorted(por_bairro.items()):
            if n:
                novos.append(linha(por_id[pk], acao, n, False))
        for acao in ACOES:
            sem = grupos[AMBIGUO][acao] + grupos[NAO_IDENTIFICADO][acao]
            if sem:
                novos.append(linha(municipio, acao, sem, True))
        ids_dos_meses += [
            id_indicador(a, leitura.ano, leitura.mes, sem_bairro=s) for a in ACOES for s in (0, 1)
        ]
    with transaction.atomic():
        IndicadorTerritorialExterno.objects.filter(indicador__in=ids_dos_meses).delete()
        IndicadorTerritorialExterno.objects.bulk_create(novos)
    resultado.gravados = len(novos)
    return resultado


def _ultimo_dia(ano: int, mes: int) -> date:
    primeiro = date(ano, mes, 1)
    return (primeiro.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
