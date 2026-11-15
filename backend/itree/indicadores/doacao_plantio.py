"""Doação de mudas e plantio da URBFOR (F-04, planilhas de 2022).

Fonte: dataset ``doacao-mudas-pf`` do portal de dados abertos de Fortaleza (URBFOR, licença
``cc-by-sa``, atualizado em 2022-12-21), com três planilhas XLSX em formato de ficha (a leitura,
em ``fichas_urbfor``): doação a pessoa física, doação a pessoa jurídica e plantio.

- **Doação**: quantidade por espécie e ficha, sem local. Entra só em Análises. Requerente e
  endereço nunca são gravados (na doação a pessoa física informa o próprio nome).
- **Plantio**: data, endereço em texto, local e espécies. **Não geocodifica e não cria árvore**
  (DP-18). O bairro sai do texto do endereço, com os aliases do manejo da URBFOR; sem bairro no
  texto, fica vazio, com o motivo.
"""

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date

from django.db import transaction
from django.utils import timezone

from itree.inventario.importacao import CatalogoEspecies
from itree.inventario.leitura_arquivos import ler_abas_xlsx
from itree.territorio.models import Territorio, TipoTerritorio

from . import fichas_urbfor as fichas
from .fichas_urbfor import simples
from .manejo_urbfor import (
    AMBIGUO,
    IndiceBairros,
    _finais_dos_trechos,
    bairro_do_servico,
)
from .models import DoacaoMudas, MotivoSemBairro, RegistroPlantio, TipoBeneficiario

DATASET = "doacao-mudas-pf"
API_CKAN = "https://dados.fortaleza.ce.gov.br/api/3/action/package_show"
FONTE = "URBFOR (Autarquia de Urbanismo e Paisagismo de Fortaleza)"
FONTE_URL = f"https://dados.fortaleza.ce.gov.br/dataset/{DATASET}"
LICENCA = "Creative Commons Atribuição-CompartilhaIgual (cc-by-sa), declarada no CKAN"
# Última modificação das planilhas no CKAN (2022-12-21): a fonte não traz outra data.
DATA_REFERENCIA = date(2022, 12, 21)
ANO = 2022

# Identificador de cada recurso no CKAN, para baixar a planilha certa.
RECURSOS = {
    "pf": "7c894d24-cbe7-4683-b7a0-494d40bc642d",
    "pj": "8831df9e-f2de-414e-9697-d0c036a53b47",
    "plantio": "7098bcbb-a6c3-4f37-bd56-1d565bacd377",
}
ROTULOS_CATEGORIA = {
    "ornamental": "Ornamental",
    "nativa_frutifera": "Nativa ou frutífera",
    "palmeira": "Palmeira",
    "medicinal": "Medicinal",
    "": "Categoria não informada",
}
NOME_ANALISE_DOACAO = "Mudas doadas por espécie (URBFOR, 2022)"
NOME_ANALISE_CATEGORIA = "Mudas doadas por categoria (URBFOR, 2022)"
NOME_ANALISE_PLANTIO = "Plantios por bairro (URBFOR, 2022)"


class PlanilhaInvalida(ValueError):
    """A planilha não tem o formato esperado ou falta cadastro para importá-la."""


@dataclass
class ResultadoDoacao:
    beneficiario: str
    fichas: int = 0
    fichas_sem_especie: int = 0
    linhas: int = 0
    mudas: int = 0
    mudas_sem_categoria: int = 0
    linhas_no_catalogo: int = 0
    total_declarado: int = 0
    fichas_com_total_diferente: int = 0
    nao_entendidas: list[tuple[int, str, str]] = field(default_factory=list)


@dataclass
class ResultadoPlantio:
    fichas: int = 0
    fichas_sem_especie: int = 0
    mudas: int = 0
    total_declarado: int = 0
    com_bairro: int = 0
    mudas_com_bairro: int = 0
    motivos: Counter = field(default_factory=Counter)
    textos_nao_reconhecidos: Counter = field(default_factory=Counter)
    nao_entendidas: list[tuple[int, str, str]] = field(default_factory=list)


def _ano_e_mes(ficha: fichas.Ficha) -> tuple[int | None, int | None]:
    ano = ficha.ano or (ficha.data.year if ficha.data else None)
    mes = ficha.mes or (ficha.data.month if ficha.data else None)
    return ano, mes


def importar_doacao(planilhas: dict[str, bytes], *, ingerido_em=None) -> dict[str, ResultadoDoacao]:
    """``planilhas`` mapeia "pf" e "pj" ao conteúdo do XLSX. Para cada tipo, troca as linhas dos
    anos presentes na planilha (idempotente). A leitura é toda feita antes de gravar."""
    agora = ingerido_em or timezone.now()
    catalogo = CatalogoEspecies()
    resultados: dict[str, ResultadoDoacao] = {}
    novas: dict[str, list[DoacaoMudas]] = {}
    for beneficiario, conteudo in planilhas.items():
        if beneficiario not in TipoBeneficiario.values:
            raise PlanilhaInvalida(f"Tipo de beneficiário desconhecido: {beneficiario}.")
        leitura = fichas.ler_planilha(ler_abas_xlsx(conteudo))
        r = ResultadoDoacao(beneficiario, nao_entendidas=list(leitura.nao_entendidas))
        linhas: list[DoacaoMudas] = []
        for ficha in leitura.fichas:
            ano, mes = _ano_e_mes(ficha)
            if not ficha.itens:
                r.fichas_sem_especie += 1
                continue
            if ano is None:
                r.nao_entendidas.append((ficha.linha, "ficha sem mês nem data", ""))
                continue
            r.fichas += 1
            r.total_declarado += ficha.total_declarado or 0
            if ficha.total_declarado is not None and ficha.total_declarado != ficha.total:
                r.fichas_com_total_diferente += 1
            for item in ficha.itens:
                especie, via, _ = catalogo.resolver(item.especie)
                linhas.append(
                    DoacaoMudas(
                        ano=ano,
                        mes=mes,
                        data=ficha.data,
                        beneficiario=beneficiario,
                        categoria=item.categoria,
                        categoria_via=item.categoria_via,
                        especie_texto=item.especie[:200],
                        especie=especie,
                        especie_via=via,
                        quantidade=item.quantidade,
                        linha_origem=item.linha,
                        **_proveniencia(agora),
                    )
                )
                r.linhas += 1
                r.mudas += item.quantidade
                r.mudas_sem_categoria += 0 if item.categoria else item.quantidade
                r.linhas_no_catalogo += 1 if especie else 0
        if not linhas:
            raise PlanilhaInvalida(
                f"A planilha de doação ({beneficiario.upper()}) não trouxe ficha com espécie."
            )
        resultados[beneficiario] = r
        novas[beneficiario] = linhas
    with transaction.atomic():
        for beneficiario, linhas in novas.items():
            DoacaoMudas.objects.filter(
                beneficiario=beneficiario, ano__in={x.ano for x in linhas}
            ).delete()
            DoacaoMudas.objects.bulk_create(linhas, batch_size=1000)
    return resultados


def _proveniencia(agora) -> dict:
    return {
        "fonte": FONTE,
        "fonte_url": FONTE_URL,
        "licenca": LICENCA,
        "data_referencia": DATA_REFERENCIA,
        "ingerido_em": agora,
    }


def _so_numero(texto: str | None) -> bool:
    """Número de imóvel ("205", "s/n", "nº 330"): é o fim da rua, não um bairro."""
    return texto is None or bool(re.fullmatch(r"(n |no |numero )?\d+[a-z]?|s n|sn", simples(texto)))


def bairro_do_endereco(endereco: str, indice: IndiceBairros) -> tuple[Territorio | None, str]:
    """(bairro, motivo): o bairro lido do texto do endereço, ou ``None`` com o motivo.

    Vale a regra do manejo da URBFOR (o bairro é o fim de cada trecho, "Rua X - Bairro Y"). Um
    endereço sem separador que seja, inteiro, o nome de um bairro ("Estoril" não é; "Aldeota"
    seria) também vale."""
    if not endereco.strip():
        return None, MotivoSemBairro.SEM_ENDERECO
    achado = bairro_do_servico(endereco, indice)
    if isinstance(achado, Territorio):
        return achado, ""
    finais = _finais_dos_trechos(endereco)
    if all(f is None for f in finais):
        inteiro = indice.procurar(endereco)
        if isinstance(inteiro, Territorio):
            return inteiro, ""
    if achado == AMBIGUO:
        return None, MotivoSemBairro.AMBIGUO
    if all(_so_numero(f) for f in finais):
        return None, MotivoSemBairro.SEM_TEXTO
    return None, MotivoSemBairro.NAO_RECONHECIDO


def importar_plantio(conteudo: bytes, *, ingerido_em=None) -> ResultadoPlantio:
    """Lê as fichas de plantio, resolve o bairro pelo texto do endereço e troca as linhas dos
    anos presentes (idempotente). Exige os bairros cadastrados (``importar_limites_fortaleza``)."""
    bairros = list(Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO))
    if not bairros:
        raise PlanilhaInvalida("Cadastre os bairros antes (manage.py importar_limites_fortaleza).")
    indice = IndiceBairros.de(bairros)
    agora = ingerido_em or timezone.now()
    leitura = fichas.ler_planilha(ler_abas_xlsx(conteudo))
    r = ResultadoPlantio(nao_entendidas=list(leitura.nao_entendidas))
    registros: list[RegistroPlantio] = []
    for ficha in leitura.fichas:
        ano, mes = _ano_e_mes(ficha)
        if not ficha.itens:
            r.fichas_sem_especie += 1
            continue
        if ano is None:
            r.nao_entendidas.append((ficha.linha, "ficha sem mês nem data", ""))
            continue
        bairro, motivo = bairro_do_endereco(ficha.endereco, indice)
        registros.append(
            RegistroPlantio(
                ano=ano,
                mes=mes,
                data=ficha.data,
                data_fim=ficha.data_fim,
                endereco=ficha.endereco[:300],
                local=ficha.local[:300],
                bairro=bairro,
                motivo_sem_bairro=motivo,
                especies=[
                    {"especie": i.especie, "categoria": i.categoria, "quantidade": i.quantidade}
                    for i in ficha.itens
                ],
                total_mudas=ficha.total,
                total_declarado=ficha.total_declarado,
                linha_origem=ficha.linha,
                **_proveniencia(agora),
            )
        )
        r.fichas += 1
        r.mudas += ficha.total
        r.total_declarado += ficha.total_declarado or 0
        if bairro:
            r.com_bairro += 1
            r.mudas_com_bairro += ficha.total
        else:
            r.motivos[motivo] += 1
            if motivo == MotivoSemBairro.NAO_RECONHECIDO:
                final = next(iter(reversed(_finais_dos_trechos(ficha.endereco))), None)
                r.textos_nao_reconhecidos[final or ficha.endereco] += ficha.total
    if not registros:
        raise PlanilhaInvalida("A planilha de plantio não trouxe nenhuma ficha com espécie.")
    with transaction.atomic():
        RegistroPlantio.objects.filter(ano__in={x.ano for x in registros}).delete()
        RegistroPlantio.objects.bulk_create(registros, batch_size=500)
    return r


def baixar_planilhas(chaves: list[str]) -> dict[str, bytes]:
    """Baixa as planilhas pedidas ("pf", "pj", "plantio") pelo CKAN, com repetição em 502/504."""
    import requests

    from .management.commands.importar_manejo_urbfor import _obter

    try:
        recursos = _obter(API_CKAN, params={"id": DATASET}).json()["result"]["resources"]
        por_id = {r["id"]: r["url"] for r in recursos}
        baixadas = {}
        for chave in chaves:
            url = por_id.get(RECURSOS[chave])
            if not url:
                raise PlanilhaInvalida(f"O dataset não tem mais o recurso da planilha '{chave}'.")
            baixadas[chave] = _obter(url).content
    except (requests.RequestException, KeyError, ValueError) as exc:
        raise PlanilhaInvalida(f"Não foi possível obter as planilhas da URBFOR: {exc}") from exc
    return baixadas
