"""Indicadores de fontes públicas externas, por bairro (Censo 2022 do IBGE).

Primeiro indicador: arborização do entorno. Fonte: IBGE, Censo Demográfico 2022,
Características urbanísticas do entorno dos domicílios, agregados por bairro,
tabela "faces" (faces de quadra recenseadas). Dicionário do IBGE
(``dicionario_entorno_faces.xlsx``, em ``dicionarios_de_dados_entorno.zip``):

- V05400 faces no setor (aqui, no bairro)
- V05430 face com arborização, sem árvores
- V05431 face com arborização, de 1 a 2 árvores
- V05432 face com arborização, de 3 a 4 árvores
- V05433 face com arborização, 5 ou mais árvores
- V05434 face com arborização, saltado (o quesito não foi coletado)

O indicador é o percentual de faces com ao menos uma árvore. O numerador soma
V05431, V05432 e V05433; o denominador é V05400, que inclui as faces saltadas
(contam como "sem informação de árvore", escolha conservadora).
"""

import csv
import io
import zipfile
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

import requests
from django.conf import settings
from django.contrib.gis.db.models.functions import PointOnSurface
from django.db import transaction
from django.utils import timezone

from itree.contas.acesso import area_do_escopo, tem_escopo_municipal
from itree.contas.models import Usuario
from itree.territorio.models import Territorio, TipoTerritorio

from .models import IndicadorTerritorialExterno

ARBORIZACAO_FACES = "arborizacao_faces_com_arvore"

FONTE_CENSO = "IBGE, Censo Demográfico 2022"
URL_CENSO_FACES = (
    "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/"
    "Agregados_por_Setores_Censitarios_Caracteristicas_urbanisticas_do_entorno_dos_domicilios/"
    "Agregados_por_Bairro_csv/Agregados_por_bairros_entorno_faces_BR.zip"
)
# O FTP do IBGE não declara licença; a política de dados abertos do órgão ainda
# precisa ser confirmada (DP-11). Enquanto isso, o texto diz exatamente isso.
LICENCA_CENSO = (
    "Não declarada no FTP do IBGE; política de dados abertos do órgão a confirmar (DP-11)"
)
# Data de referência do Censo Demográfico 2022: 1º de agosto de 2022.
DATA_REFERENCIA_CENSO = date(2022, 8, 1)

NOME_ARBORIZACAO = "Faces de quadra com árvores (Censo 2022)"
DEFINICAO_ARBORIZACAO = (
    "Percentual das faces de quadra do bairro em que o Censo 2022 registrou ao menos uma "
    "árvore no entorno dos domicílios. Face de quadra é um lado de quarteirão; a "
    "arborização foi observada pelo recenseador na face, não é medida de copa nem de "
    "cobertura vegetal."
)
METODO_ARBORIZACAO = (
    "Tabela de faces por bairro do IBGE (agregados do entorno dos domicílios). "
    "Numerador = V05431 (1 a 2 árvores) + V05432 (3 a 4) + V05433 (5 ou mais). "
    "Denominador = V05400 (total de faces do bairro), que inclui as faces com o quesito "
    "saltado (V05434). Valor = numerador ÷ denominador × 100. Bairros do escopo somam "
    "numeradores e denominadores; o percentual não é a média dos percentuais."
)

COLUNAS_ARVORE = ("V05431", "V05432", "V05433")
COLUNAS_FACES = ("V05430", "V05431", "V05432", "V05433", "V05434")


class CensoInvalido(ValueError):
    """O arquivo não tem o formato do Censo 2022 esperado."""


@dataclass
class LeituraCenso:
    por_bairro: dict[str, tuple[int, int]] = field(default_factory=dict)
    linhas: int = 0
    inconsistentes: int = 0


def baixar(url: str = URL_CENSO_FACES) -> bytes:
    resposta = requests.get(url, timeout=getattr(settings, "IBGE_TIMEOUT", 120))
    resposta.raise_for_status()
    return resposta.content


def _csv_do_conteudo(conteudo: bytes) -> str:
    if zipfile.is_zipfile(io.BytesIO(conteudo)):
        with zipfile.ZipFile(io.BytesIO(conteudo)) as z:
            nomes = [n for n in z.namelist() if n.lower().endswith(".csv")]
            if len(nomes) != 1:
                raise CensoInvalido("O ZIP deve conter exatamente um CSV.")
            conteudo = z.read(nomes[0])
    # O IBGE publica em ISO-8859-1.
    return conteudo.decode("iso-8859-1")


def ler_csv(conteudo: bytes, codigos: set[str] | None = None) -> LeituraCenso:
    """Lê o CSV (ou o ZIP) de faces por bairro. Com ``codigos``, só esses bairros
    entram. Linhas cujas faces por arborização não somam V05400 são descartadas e
    contadas em ``inconsistentes``."""
    leitor = csv.DictReader(io.StringIO(_csv_do_conteudo(conteudo)), delimiter=";")
    esperadas = {"CD_BAIRRO", "V05400", *COLUNAS_FACES}
    if not esperadas <= set(leitor.fieldnames or []):
        raise CensoInvalido(
            "Colunas ausentes: " + ", ".join(sorted(esperadas - set(leitor.fieldnames or [])))
        )
    leitura = LeituraCenso()
    for linha in leitor:
        codigo = (linha["CD_BAIRRO"] or "").strip()
        if codigos is not None and codigo not in codigos:
            continue
        leitura.linhas += 1
        try:
            total = int(linha["V05400"])
            faixas = [int(linha[c]) for c in COLUNAS_FACES]
        except ValueError:
            # "X" (dado omitido por sigilo) ou vazio: sem número, sem indicador.
            leitura.inconsistentes += 1
            continue
        if sum(faixas) != total:
            leitura.inconsistentes += 1
            continue
        leitura.por_bairro[codigo] = (sum(int(linha[c]) for c in COLUNAS_ARVORE), total)
    return leitura


@dataclass
class ResultadoImportacao:
    gravados: int = 0
    bairros_sem_dado: list[str] = field(default_factory=list)
    inconsistentes: int = 0


def importar(
    conteudo: bytes, *, fonte_url: str = URL_CENSO_FACES, ingerido_em=None
) -> ResultadoImportacao:
    """Grava a arborização do entorno dos bairros cujo ``codigo`` bate com o
    ``CD_BAIRRO`` do IBGE. Idempotente: repetir atualiza as linhas existentes."""
    bairros = {t.codigo: t for t in Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO)}
    leitura = ler_csv(conteudo, set(bairros))
    agora = ingerido_em or timezone.now()
    resultado = ResultadoImportacao(inconsistentes=leitura.inconsistentes)
    with transaction.atomic():
        for codigo, (numerador, denominador) in leitura.por_bairro.items():
            IndicadorTerritorialExterno.objects.update_or_create(
                territorio=bairros[codigo],
                indicador=ARBORIZACAO_FACES,
                defaults={
                    "numerador": numerador,
                    "denominador": denominador,
                    "valor": _percentual(numerador, denominador),
                    "unidade": "%",
                    "fonte": FONTE_CENSO,
                    "fonte_url": fonte_url,
                    "licenca": LICENCA_CENSO,
                    "data_referencia": DATA_REFERENCIA_CENSO,
                    "ingerido_em": agora,
                    "definicao": DEFINICAO_ARBORIZACAO,
                    "metodo": METODO_ARBORIZACAO,
                },
            )
            resultado.gravados += 1
    resultado.bairros_sem_dado = sorted(
        b.nome for c, b in bairros.items() if c not in leitura.por_bairro
    )
    return resultado


def _percentual(numerador: int, denominador: int | None) -> Decimal | None:
    if not denominador:
        return None
    return (Decimal(100 * numerador) / Decimal(denominador)).quantize(Decimal("0.01"))


def bairros_do_escopo(usuario: Usuario):
    """Bairros do escopo do usuário: todos, no escopo municipal; senão, os que têm
    um ponto interior dentro da área do escopo (evita contar vizinhos que só
    encostam no limite)."""
    bairros = Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO)
    if tem_escopo_municipal(usuario):
        return bairros
    area = area_do_escopo(usuario)
    if area is None:
        return bairros.none()
    return bairros.annotate(ponto=PointOnSurface("geom")).filter(ponto__within=area)


def contexto_externo(usuario: Usuario, bairro: Territorio | None = None) -> list[dict]:
    """Seção "Contexto (fontes externas)" da visão geral: um item por indicador,
    com o valor do escopo (soma de numeradores e denominadores) e a proveniência.
    Sem dado, a lista é vazia (nunca zero)."""
    bairros = bairros_do_escopo(usuario)
    if bairro is not None:
        bairros = bairros.filter(pk=bairro.pk)
    ids = list(bairros.values_list("pk", flat=True))
    linhas = IndicadorTerritorialExterno.objects.filter(territorio_id__in=ids)
    por_indicador: dict[str, list[IndicadorTerritorialExterno]] = {}
    for linha in linhas.order_by("indicador", "territorio__nome"):
        por_indicador.setdefault(linha.indicador, []).append(linha)
    itens = []
    for indicador, grupo in por_indicador.items():
        numerador = sum(i.numerador for i in grupo)
        bases = [i.denominador for i in grupo if i.denominador is not None]
        denominador = sum(bases) if bases else None
        valor = _percentual(numerador, denominador)
        modelo = grupo[0]
        itens.append(
            {
                "id": indicador,
                "nome": NOMES.get(indicador, indicador),
                "valor": float(valor) if valor is not None else None,
                "numerador": numerador,
                "base": denominador,
                "unidade": modelo.unidade,
                "fonte": modelo.fonte,
                "fonte_url": modelo.fonte_url,
                "licenca": modelo.licenca,
                "data_referencia": modelo.data_referencia,
                "ingerido_em": max(i.ingerido_em for i in grupo),
                "definicao": modelo.definicao,
                "metodo": modelo.metodo,
                "bairros_com_dado": len(grupo),
                "bairros_no_escopo": len(ids),
            }
        )
    return itens


NOMES = {ARBORIZACAO_FACES: NOME_ARBORIZACAO}
