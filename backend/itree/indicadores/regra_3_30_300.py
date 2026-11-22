"""Regra 3-30-300 por bairro (Konijnendijk, 2021): o cálculo pesado e a leitura do resultado.

    "3"   quantas das edificações do bairro têm pelo menos 3 árvores a até 30 m;
    "30"  cobertura vegetal do bairro (NDVI de 10 m, UrbVerde): percentual de pixels com vegetação;
    "300" quantas das edificações ficam a até 300 m de uma área verde pública de 0,5 ha ou mais.

O cálculo (``calcular``) é pesado (centenas de milhares de edificações) e roda no comando
``calcular_3_30_300``: nunca na requisição. O resultado fica em ``ResultadoRegra330300`` por
bairro, data e contagem de árvores; a leitura (``resultados``, ``cidade``) só soma linhas gravadas.
O método e as aproximações estão em ``docs/indicadores/3-30-300.md``.

Fonte do método: Konijnendijk, C. C. (2022). Evidence-based guidelines for greener, healthier, more
resilient neighbourhoods: Introducing the 3-30-300 rule. *Journal of Forestry Research*, 33,
1707-1717 (primeira divulgação em 2021).
"""

import logging
from dataclasses import dataclass
from datetime import date

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone

from itree.areas_verdes.models import AreaVerde, SubtipoAreaVerde
from itree.inventario.models import Arvore
from itree.territorio.models import Territorio, TipoTerritorio

from . import contagem as cont
from . import instantaneos, vegetacao
from .models import IndicadorTerritorialExterno, ResultadoRegra330300

logger = logging.getLogger(__name__)

TODAS = "todas"
CONFIRMADAS = "confirmadas"
CONTAGENS = (TODAS, CONFIRMADAS)

ARVORES_MINIMAS = 3
RAIO_ARVORES_M = 30
RAIO_AREA_VERDE_M = 300
AREA_VERDE_MIN_M2 = 5000  # 0,5 ha
COBERTURA_META_PCT = 30
SRC_METRICO = 31984  # SIRGAS 2000 / UTM 24S
SUBTIPOS_EXCLUIDOS = (SubtipoAreaVerde.ROTATORIA, SubtipoAreaVerde.CALCADAO)

FONTE_METODO = (
    "Konijnendijk, C. C. (2022). Evidence-based guidelines for greener, healthier, more resilient "
    "neighbourhoods: Introducing the 3-30-300 rule. Journal of Forestry Research, 33, 1707-1717."
)
FONTE_URL = "https://doi.org/10.1007/s11676-022-01523-z"
REGRA = (
    "Regra 3-30-300: 3 árvores visíveis de cada casa, 30% de cobertura de copa, "
    "área verde a até 300 m."
)

PARTES = {
    "3": {
        "id": "3",
        "nome": "3 árvores a até 30 m",
        "meta": "3 árvores a até 30 m",
        "unidade": "% das edificações",
        "descricao": (
            "Percentual das edificações do bairro com pelo menos 3 árvores do inventário a até "
            "30 m (distância em linha reta, do centro da edificação à árvore)."
        ),
    },
    "30": {
        "id": "30",
        "nome": "30% de cobertura vegetal",
        "meta": "30% de cobertura",
        "unidade": "% da área do bairro",
        "descricao": (
            "Percentual da área do bairro com vegetação (NDVI de 10 m ≥ limiar). É vegetação, "
            "não só copa de árvore; com copas detectadas, a cobertura de copa passa a ser a medida."
        ),
    },
    "300": {
        "id": "300",
        "nome": "Área verde a até 300 m",
        "meta": "área verde a até 300 m",
        "unidade": "% das edificações",
        "descricao": (
            "Percentual das edificações do bairro a até 300 m (linha reta, não pela rede viária) "
            "de uma área verde pública de pelo menos 0,5 ha (praça, parque ou unidade de "
            "conservação oficiais)."
        ),
    },
}

METODO = (
    "Edificações: contornos do Google Open Buildings v3 (CC BY 4.0), recortados pelo município. "
    "Base: edificações em lote de uso predominante residencial (SEFIN, 2022, regra dos 70%) quando "
    "o uso foi classificado; sem a classificação, todas as edificações (declarado na tela). "
    '"3": árvores do inventário (válidas, ativas e com localização) a até 30 m do ponto central da '
    'edificação, em SIRGAS 2000 / UTM 24S; conta-se também só as de espécie confirmada. "30": '
    "pixels de NDVI de 10 m (UrbVerde, 2021) com valor ≥ limiar (0,4) sobre os pixels medidos do "
    'bairro. "300": distância euclidiana do ponto central da edificação à área verde oficial '
    "(praça, parque ou unidade de conservação, sem rotatória e calçadão) com pelo menos 0,5 ha, "
    "calculada no mesmo SRC métrico. Cidade = soma dos numeradores ÷ soma dos denominadores dos "
    "bairros (não é a média dos percentuais)."
)
RESSALVA_INVENTARIO = (
    "Conta só as árvores do inventário: onde o inventário é incompleto, o valor é um piso, não "
    "o retrato da arborização."
)


def meta_residencias_pct() -> float:
    """Percentual de residências que um bairro precisa ter em "3" e "300" para "atender". A regra
    vale para cada casa; por isso o padrão é 100 (todas)."""
    return float(getattr(settings, "REGRA_3_30_300_META_RESIDENCIAS_PCT", 100))


def arvores_da_contagem(contagem: str):
    """Árvores válidas da contagem ``todas`` (ativas, com localização e origem) ou ``confirmadas``
    (confirmadas por revisão ou inspeção, pelo helper compartilhado ``indicadores.contagem``)."""
    if contagem not in CONTAGENS:
        raise ValueError(f"Contagem desconhecida: {contagem!r}.")
    return cont.filtrar(instantaneos.arvores_validas(Arvore.objects.all()), contagem)


@dataclass
class ParteBairro:
    numerador: int | None
    denominador: int | None

    @property
    def pct(self) -> float | None:
        if self.numerador is None or not self.denominador:
            return None
        return round(100 * self.numerador / self.denominador, 1)


# --- Cálculo -------------------------------------------------------------------------------------


def _sql_arvores(contagem: str) -> tuple[str, list]:
    qs = arvores_da_contagem(contagem).order_by().values("pk", "geom")
    sql, params = qs.query.sql_with_params()
    return f"SELECT ST_Transform(geom, {SRC_METRICO}) AS g FROM ({sql}) q", list(params)  # noqa: S608


def _preparar_base(cursor, base: str) -> None:
    cursor.execute("DROP TABLE IF EXISTS tmp_base")
    filtro = "AND e.uso = 'residencial'" if base == "residenciais" else ""
    cursor.execute(
        f"""
        CREATE TEMP TABLE tmp_base ON COMMIT DROP AS
        SELECT e.bairro_id, ST_Transform(e.centro, {SRC_METRICO}) AS c
          FROM imoveis_edificacao e
         WHERE e.bairro_id IS NOT NULL {filtro}
        """  # noqa: S608 - SRC e filtro são constantes deste módulo
    )
    cursor.execute("CREATE INDEX tmp_base_c ON tmp_base USING gist (c)")


def _base_das_edificacoes(cursor) -> str:
    """ "residenciais" se há edificações com uso classificado; senão, "todas"."""
    cursor.execute("SELECT EXISTS (SELECT 1 FROM imoveis_edificacao WHERE uso = 'residencial')")
    return "residenciais" if cursor.fetchone()[0] else "todas"


def parte_3(cursor, contagem: str) -> dict:
    """Por bairro: edificações da base com 3 árvores ou mais a até 30 m."""
    sql_arvores, params = _sql_arvores(contagem)
    cursor.execute("DROP TABLE IF EXISTS tmp_arvores")
    cursor.execute(f"CREATE TEMP TABLE tmp_arvores ON COMMIT DROP AS {sql_arvores}", params)
    cursor.execute("CREATE INDEX tmp_arvores_g ON tmp_arvores USING gist (g)")
    cursor.execute("SELECT count(*) FROM tmp_arvores")
    total_arvores = cursor.fetchone()[0]
    cursor.execute(
        """
        SELECT b.bairro_id,
               count(*) FILTER (WHERE (
                   SELECT count(*) FROM (
                       SELECT 1 FROM tmp_arvores t WHERE ST_DWithin(t.g, b.c, %s) LIMIT %s
                   ) x
               ) >= %s)
          FROM tmp_base b GROUP BY b.bairro_id
        """,
        [RAIO_ARVORES_M, ARVORES_MINIMAS, ARVORES_MINIMAS],
    )
    por_bairro = dict(cursor.fetchall())
    cursor.execute("DROP TABLE tmp_arvores")
    return {"arvores": total_arvores, "por_bairro": por_bairro}


def _areas_verdes_validas():
    return AreaVerde.objects.exclude(subtipo__in=SUBTIPOS_EXCLUIDOS)


def parte_300(cursor) -> dict:
    """Por bairro: edificações da base a até 300 m de área verde pública de 0,5 ha ou mais."""
    qs = _areas_verdes_validas().order_by().values("pk", "geom")
    sql, params = qs.query.sql_with_params()
    cursor.execute("DROP TABLE IF EXISTS tmp_verdes")
    cursor.execute(
        f"""
        CREATE TEMP TABLE tmp_verdes ON COMMIT DROP AS
        SELECT ST_Transform(geom, {SRC_METRICO}) AS g FROM ({sql}) q
        """,  # noqa: S608
        list(params),
    )
    cursor.execute("DELETE FROM tmp_verdes WHERE ST_Area(g) < %s", [AREA_VERDE_MIN_M2])
    cursor.execute("CREATE INDEX tmp_verdes_g ON tmp_verdes USING gist (g)")
    cursor.execute("SELECT count(*) FROM tmp_verdes")
    n_verdes = cursor.fetchone()[0]
    cursor.execute(
        """
        SELECT b.bairro_id,
               count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM tmp_verdes v WHERE ST_DWithin(v.g, b.c, %s)
               ))
          FROM tmp_base b GROUP BY b.bairro_id
        """,
        [RAIO_AREA_VERDE_M],
    )
    por_bairro = dict(cursor.fetchall())
    cursor.execute("DROP TABLE tmp_verdes")
    return {"areas_verdes": n_verdes, "por_bairro": por_bairro}


def parte_30() -> dict:
    """Cobertura vegetal gravada por ``importar_cobertura_vegetal``: (pixels com vegetação,
    pixels medidos) por bairro. Vazio sem o indicador."""
    linhas = IndicadorTerritorialExterno.objects.filter(
        indicador=vegetacao.INDICADOR, denominador__gt=0
    ).values_list("territorio_id", "numerador", "denominador", "versao")
    return {t: (n, d) for t, n, d, _ in linhas}


def calcular(*, data: date | None = None, agora=None) -> dict:
    """Calcula e grava a regra 3-30-300 de todos os bairros, para as duas contagens de árvores.
    Idempotente no dia (atualiza as linhas de ``data``). Devolve um resumo."""
    agora = agora or timezone.now()
    data = data or timezone.localdate(agora)
    bairros = list(
        Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO).values_list("pk", flat=True)
    )
    vegetal = parte_30()
    resumo: dict = {"data": data.isoformat(), "bairros": len(bairros), "contagens": {}}
    with transaction.atomic(), connection.cursor() as cursor:
        base = _base_das_edificacoes(cursor)
        _preparar_base(cursor, base)
        cursor.execute("SELECT bairro_id, count(*) FROM tmp_base GROUP BY bairro_id")
        edificacoes = dict(cursor.fetchall())
        cursor.execute(
            "SELECT bairro_id, count(*) FROM imoveis_edificacao WHERE bairro_id IS NOT NULL"
            " GROUP BY bairro_id"
        )
        todas_edif = dict(cursor.fetchall())
        cursor.execute(
            "SELECT bairro_id, count(*) FROM imoveis_edificacao WHERE uso <> ''"
            " AND bairro_id IS NOT NULL GROUP BY bairro_id"
        )
        classificadas = dict(cursor.fetchall())
        p300 = parte_300(cursor)
        for contagem in CONTAGENS:
            p3 = parte_3(cursor, contagem)
            for pk in bairros:
                n = edificacoes.get(pk, 0)
                veg = vegetal.get(pk)
                ResultadoRegra330300.objects.update_or_create(
                    bairro_id=pk,
                    data=data,
                    contagem=contagem,
                    defaults={
                        "base_edificacoes": base,
                        "edificacoes": n,
                        "com_3_arvores": p3["por_bairro"].get(pk, 0) if n else None,
                        "pixels_vegetacao": veg[0] if veg else None,
                        "pixels_medidos": veg[1] if veg else None,
                        "perto_de_area_verde": p300["por_bairro"].get(pk, 0) if n else None,
                        "calculado_em": agora,
                        "metadados": {
                            "edificacoes_no_bairro": todas_edif.get(pk, 0),
                            "edificacoes_classificadas": classificadas.get(pk, 0),
                            "arvores_no_inventario": p3["arvores"],
                            "areas_verdes_de_meio_hectare": p300["areas_verdes"],
                            "limiar_ndvi": vegetacao.limiar(),
                        },
                    },
                )
            resumo["contagens"][contagem] = {"arvores": p3["arvores"]}
    resumo.update(
        base=base,
        edificacoes=sum(edificacoes.values()),
        areas_verdes=p300["areas_verdes"],
        bairros_com_vegetacao=len(vegetal),
    )
    return resumo


# --- Leitura -------------------------------------------------------------------------------------


def _ultima_data(contagem: str) -> date | None:
    return (
        ResultadoRegra330300.objects.filter(contagem=contagem)
        .order_by("-data")
        .values_list("data", flat=True)
        .first()
    )


def resultados(bairro_ids=None, contagem: str = TODAS) -> dict:
    """Último resultado gravado de cada bairro: {bairro_id: ResultadoRegra330300}."""
    if contagem not in CONTAGENS:
        contagem = TODAS
    data = _ultima_data(contagem)
    if data is None:
        return {}
    qs = ResultadoRegra330300.objects.filter(contagem=contagem, data=data)
    if bairro_ids is not None:
        qs = qs.filter(bairro_id__in=list(bairro_ids))
    return {r.bairro_id: r for r in qs}


def partes_do_resultado(r: ResultadoRegra330300) -> dict[str, ParteBairro]:
    return {
        "3": ParteBairro(r.com_3_arvores, r.edificacoes or None),
        "30": ParteBairro(r.pixels_vegetacao, r.pixels_medidos),
        "300": ParteBairro(r.perto_de_area_verde, r.edificacoes or None),
    }


def cidade(resultados_: dict) -> dict[str, float | None]:
    """Referência da cidade por parte: soma dos numeradores ÷ soma dos denominadores."""
    saida = {}
    for parte in PARTES:
        num = den = 0
        for r in resultados_.values():
            p = partes_do_resultado(r)[parte]
            if p.numerador is not None and p.denominador:
                num += p.numerador
                den += p.denominador
        saida[parte] = round(100 * num / den, 1) if den else None
    return saida


def atende(parte: str, pct: float | None) -> bool | None:
    """Selo da parte: ``None`` sem dado; "30" atende com ≥ 30%; "3" e "300", com a meta de
    residências."""
    if pct is None:
        return None
    meta = COBERTURA_META_PCT if parte == "30" else meta_residencias_pct()
    return pct >= meta


def metas() -> dict:
    return {
        "3": {
            "valor": ARVORES_MINIMAS,
            "raio_m": RAIO_ARVORES_M,
            "pct_residencias": meta_residencias_pct(),
        },
        "30": {"pct": COBERTURA_META_PCT},
        "300": {
            "raio_m": RAIO_AREA_VERDE_M,
            "area_minima_ha": AREA_VERDE_MIN_M2 / 10_000,
            "pct_residencias": meta_residencias_pct(),
        },
    }
