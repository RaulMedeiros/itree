"""Critérios por bairro para o cenário "Onde plantar" (planejamento).

Devolve, para cada bairro, o **valor bruto** de cada critério e o **percentil de prioridade** entre
os bairros de Fortaleza (0 a 1, na direção certa: 1 é o bairro que mais pede plantio naquele
critério). A ponderação dos critérios acontece no navegador, para os controles responderem na hora.

Não é índice oficial: a fórmula oficial dos indicadores depende de decisão da prefeitura (DP-14).
O percentil usa a posição entre **todos** os bairros com dado (não só os do escopo de quem
consulta),
para o mesmo valor ter sempre o mesmo percentil; o escopo só limita os bairros devolvidos.

Bairro sem dado num critério vem com ``None`` nesse critério (nunca zero) e é ignorado na média.
O número de consultas não depende da quantidade de bairros.
"""

from datetime import datetime

from django.db import connection
from django.utils import timezone

from itree.areas_verdes.models import AreaVerde
from itree.contas.models import Usuario
from itree.territorio.models import Territorio

from . import contagem as cont
from . import ilha_calor
from . import populacao as pop
from . import populacao_indicadores as pi
from .externos import ARBORIZACAO_FACES, NOME_ARBORIZACAO, bairros_do_escopo
from .models import IndicadorTerritorialExterno

BAIXO = "baixo"  # quanto menor o valor, maior a prioridade
ALTO = "alto"  # quanto maior o valor, maior a prioridade

ARBORIZACAO = "arborizacao"
DENSIDADE = "densidade"
RENDA = "renda"
ARVORES_POR_MIL = "arvores_por_mil"
AREA_VERDE = "area_verde"
CALOR = "ilha_calor"

MOTIVO_SEM_CALOR = "Aguardando autorização de uso dos dados do UrbVerde."
AVISO = (
    "Cenário de priorização, não índice oficial: a fórmula oficial dos indicadores depende de "
    "decisão da prefeitura (DP-14)."
)
METODO_PERCENTIL = (
    "Posição do bairro entre os bairros de Fortaleza com dado, de 0 a 1 (empates dividem a "
    "posição), na direção em que o critério pede plantio; 1 é o bairro que mais precisa."
)

DEFINICAO_AREA_VERDE = (
    "Área, em m², das praças, parques e unidades de conservação do Fortaleza em Mapas que ficam "
    "dentro do bairro (recortadas pelo limite do bairro e sem contar duas vezes onde se "
    "sobrepõem), dividida pela população residente do Censo 2022."
)
METODO_AREA_VERDE = (
    "ST_Area da união dos polígonos de áreas verdes recortada pelo polígono do bairro, na "
    "geografia (esferoide) ÷ população do Censo. Bairro sem área verde dentro do limite tem 0 "
    "m²/hab; sem população do Censo, fica sem dado."
)


def percentis(valores: dict[str, float | None], direcao: str) -> dict[str, float | None]:
    """Percentil de prioridade (0 a 1) de cada chave com valor; ``None`` sem valor.

    Posição por ordem crescente, com média das posições nos empates, dividida por ``n - 1``
    (um só bairro com dado fica em 0,5). Na direção ``BAIXO`` o percentil é invertido.
    """
    com_valor = sorted((v, k) for k, v in valores.items() if v is not None)
    n = len(com_valor)
    saida: dict[str, float | None] = {k: None for k in valores}
    i = 0
    while i < n:
        j = i
        while j + 1 < n and com_valor[j + 1][0] == com_valor[i][0]:
            j += 1
        posicao = (i + j) / 2
        p = 0.5 if n == 1 else posicao / (n - 1)
        for _, chave in com_valor[i : j + 1]:
            saida[chave] = round(1 - p if direcao == BAIXO else p, 4)
        i = j + 1
    return saida


def _areas_verdes_m2() -> dict[str, float]:
    """m² de área verde dentro de cada bairro (união recortada pelo bairro), numa só consulta."""
    sql = f"""
        SELECT b.id::text,
               ST_Area(ST_CollectionExtract(
                   ST_Intersection(b.geom, ST_Union(ST_MakeValid(a.geom))), 3
               )::geography)
        FROM {Territorio._meta.db_table} b
        JOIN {AreaVerde._meta.db_table} a ON ST_Intersects(a.geom, b.geom)
        WHERE b.tipo = 'bairro'
        GROUP BY b.id, b.geom
    """  # noqa: S608 - nomes de tabela vêm dos modelos
    with connection.cursor() as cursor:
        cursor.execute(sql)
        return {pk: float(m2 or 0) for pk, m2 in cursor.fetchall()}


def _ano(data) -> int | None:
    if isinstance(data, datetime):
        return data.year
    return data.year if data else None


def _fonte_externa(prov: dict | None, padrao: str) -> dict:
    prov = prov or {}
    return {
        "fonte": prov.get("fonte") or padrao,
        "fonte_url": prov.get("fonte_url") or "",
        "licenca": prov.get("licenca") or "",
        "ano": _ano(prov.get("data_referencia")),
    }


def criterios_por_bairro(usuario: Usuario, contagem: str = cont.TODAS) -> dict:
    escopo = {str(pk) for pk in bairros_do_escopo(usuario).values_list("pk", flat=True)}
    quadro = pi.quadro(
        None, contagem=contagem
    )  # todos os bairros: o percentil não depende do escopo
    nomes = {str(x["id"]): x["nome"] for x in quadro}

    arborizacao = {
        str(i.territorio_id): float(i.valor)
        for i in IndicadorTerritorialExterno.objects.filter(indicador=ARBORIZACAO_FACES)
        if i.valor is not None
    }
    calor_linhas = list(
        IndicadorTerritorialExterno.objects.filter(
            indicador=ilha_calor.INDICADOR, valor__isnull=False
        )
    )
    calor = {str(i.territorio_id): float(i.valor) for i in calor_linhas}
    verdes_m2 = _areas_verdes_m2()
    ultima_area = (
        AreaVerde.objects.order_by("-ingerido_em")
        .values("fonte", "fonte_url", "licenca", "data_referencia", "ingerido_em")
        .first()
    )

    def coluna(chave: str) -> dict[str, float | None]:
        return {str(x["id"]): x[chave] for x in quadro}

    area_por_hab = {
        str(x["id"]): (
            round(verdes_m2.get(str(x["id"]), 0.0) / x["populacao"], 2)
            if ultima_area and x["populacao"]
            else None
        )
        for x in quadro
    }
    valores = {
        ARBORIZACAO: {pk: arborizacao.get(pk) for pk in nomes},
        DENSIDADE: coluna("densidade"),
        RENDA: coluna("renda"),
        ARVORES_POR_MIL: coluna("por_mil"),
        AREA_VERDE: area_por_hab,
        CALOR: {pk: calor.get(pk) for pk in nomes},
    }

    modelo_arb = IndicadorTerritorialExterno.objects.filter(indicador=ARBORIZACAO_FACES).first()
    prov_censo = _fonte_externa(pi.proveniencia(pop.POPULACAO_CENSO), pop.ORGAO_IBGE)
    area_fonte = (
        {
            "fonte": f"{ultima_area['fonte']}; população do {prov_censo['fonte']}",
            "fonte_url": ultima_area["fonte_url"],
            "licenca": ultima_area["licenca"],
            "ano": _ano(ultima_area["data_referencia"] or ultima_area["ingerido_em"]),
        }
        if ultima_area
        else {
            "fonte": "Fortaleza em Mapas (Ipplan Fortaleza)",
            "fonte_url": "",
            "licenca": "",
            "ano": None,
        }
    )
    calor_ok = bool(calor_linhas)
    especificacao = [
        (
            ARBORIZACAO,
            "Pouca arborização do entorno",
            "% de faces de quadra com árvore",
            BAIXO,
            "Quanto menor o percentual de faces de quadra com árvore (Censo 2022), maior a "
            "prioridade. É a percepção do recenseador, não mede copa.",
            "",
            False,
            {
                "fonte": modelo_arb.fonte if modelo_arb else "IBGE, Censo Demográfico 2022",
                "fonte_url": modelo_arb.fonte_url if modelo_arb else "",
                "licenca": modelo_arb.licenca if modelo_arb else "",
                "ano": _ano(modelo_arb.data_referencia) if modelo_arb else 2022,
            },
            NOME_ARBORIZACAO,
        ),
        (
            DENSIDADE,
            "Alta densidade populacional",
            "hab/km²",
            ALTO,
            "Quanto mais habitantes por km² (Censo 2022), maior a prioridade.",
            "",
            False,
            _fonte_externa(pi.proveniencia(pop.DENSIDADE), pop.ORGAO_IBGE),
            pop.DENSIDADE,
        ),
        (
            RENDA,
            "Baixo rendimento do responsável",
            "R$",
            BAIXO,
            "Quanto menor o rendimento médio do responsável pelo domicílio (Censo 2022), maior "
            "a prioridade: é o critério de equidade. O IDH 2010 não entra, por ser antigo.",
            "",
            False,
            _fonte_externa(pi.proveniencia(pop.RENDA), pop.ORGAO_IBGE),
            pop.NOME_RENDA,
        ),
        (
            ARVORES_POR_MIL,
            "Poucas árvores cadastradas por 1.000 habitantes",
            "por 1.000 hab.",
            BAIXO,
            "Quanto menos árvores cadastradas por 1.000 habitantes, maior a prioridade.",
            pi.RESSALVA_INVENTARIO,
            True,
            {
                "fonte": "Inventário da plataforma (árvores válidas) ÷ população do "
                + prov_censo["fonte"],
                "fonte_url": prov_censo["fonte_url"],
                "licenca": prov_censo["licenca"],
                "ano": prov_censo["ano"],
            },
            pi.DEFINICAO_POR_MIL,
        ),
        (
            AREA_VERDE,
            "Pouca área verde por habitante",
            "m²/hab.",
            BAIXO,
            "Quanto menos m² de praças, parques e unidades de conservação por habitante, maior "
            "a prioridade.",
            "",
            False,
            area_fonte,
            DEFINICAO_AREA_VERDE,
        ),
        (
            CALOR,
            "Ilha de calor de superfície",
            "°C",
            ALTO,
            "Quanto mais quente a superfície do bairro em relação à mediana de Fortaleza "
            "(UrbVerde, 2025), maior a prioridade. Não é temperatura do ar.",
            "",
            False,
            {
                "fonte": ilha_calor.FONTE,
                "fonte_url": ilha_calor.URL_FONTE,
                "licenca": ilha_calor.LICENCA,
                "ano": ilha_calor.ANO,
            },
            ilha_calor.DEFINICAO,
        ),
    ]
    metodos = {
        ARBORIZACAO: "Percentual de faces de quadra com ao menos uma árvore, por bairro.",
        DENSIDADE: "População do Censo ÷ área do polígono do bairro (UTM 24S).",
        RENDA: "Média do rendimento nominal do responsável pelo domicílio, por bairro.",
        ARVORES_POR_MIL: pi.METODO_POR_MIL,
        AREA_VERDE: METODO_AREA_VERDE,
        CALOR: ilha_calor.METODO,
    }

    todos_percentis = {}
    criterios = []
    for id_, nome, unidade, direcao, descricao, ressalva, provisorio, fonte, _ref in especificacao:
        disponivel = calor_ok if id_ == CALOR else any(v is not None for v in valores[id_].values())
        todos_percentis[id_] = percentis(valores[id_], direcao)
        com_dado = [v for v in valores[id_].values() if v is not None]
        criterios.append(
            {
                "id": id_,
                "nome": nome,
                "unidade": unidade,
                "direcao": direcao,
                "descricao": descricao,
                "disponivel": disponivel,
                "motivo_indisponivel": (
                    ""
                    if disponivel
                    else MOTIVO_SEM_CALOR
                    if id_ == CALOR
                    else "Sem dado importado."
                ),
                "ressalva": ressalva,
                "provisorio": provisorio,
                "metodo": metodos[id_],
                "bairros_com_dado": len(com_dado),
                "minimo": min(com_dado) if com_dado else None,
                "maximo": max(com_dado) if com_dado else None,
                **fonte,
            }
        )

    por_id = {str(x["id"]): x for x in quadro}
    bairros = [
        {
            "id": pk,
            "nome": nomes[pk],
            "valores": {c["id"]: valores[c["id"]][pk] for c in criterios},
            "percentis": {c["id"]: todos_percentis[c["id"]][pk] for c in criterios},
            "arvores": por_id[pk]["arvores_total"],
            "arvores_confirmadas": por_id[pk]["arvores_confirmadas"],
        }
        for pk in sorted(escopo & set(nomes), key=lambda p: nomes[p])
    ]
    return {
        "gerado_em": timezone.now(),
        "aviso": AVISO,
        "metodo_percentil": METODO_PERCENTIL,
        "contagem": contagem,
        "criterios": criterios,
        "bairros": bairros,
    }


__all__ = ["criterios_por_bairro", "percentis"]
