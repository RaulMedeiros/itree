"""Possíveis duplicidades e fusão de registros (RF-INV-013/014, RN-INV-004).

Nada é fundido automaticamente: o sistema só aponta pares para revisão."""

from django.db import connection, transaction
from django.db.models import QuerySet

from itree.evidencias.models import Evidencia
from itree.ocorrencias.models import Ocorrencia

from .models import Arvore, IdentificadorExterno, Medida, SituacaoArvore

RAIO_PADRAO_M = 3.0
CAMPOS_FUSIONAVEIS = (
    "especie",
    "especie_estado",
    "especie_texto_original",
    "geom",
    "localizacao_origem",
    "precisao_m",
    "endereco",
    "observacoes",
)


def _sql_pares(arvores: QuerySet, raio_m: float, colunas: str, final: str):
    """Monta o autojoin espacial restrito às árvores de ``arvores``.

    O conjunto visível entra como subconsulta (não como lista de ids trazida
    para o Python), para o custo não crescer com o inventário inteiro.
    """
    visiveis = arvores.filter(situacao=SituacaoArvore.ATIVA, geom__isnull=False).values("id")
    sub_sql, sub_params = visiveis.query.get_compiler(connection=connection).as_sql()
    # Pré-filtro por caixa (~1e-5 grau ≈ 1,1 m no equador) e distância exata em geografia.
    grau = raio_m / 100_000
    sql = f"""
        SELECT {colunas}
          FROM inventario_arvore a
          JOIN inventario_arvore b
            ON a.id < b.id
           AND b.geom && ST_Expand(a.geom, %s)
           AND ST_DWithin(a.geom::geography, b.geom::geography, %s)
         WHERE a.id IN ({sub_sql}) AND b.id IN ({sub_sql})
           AND (a.especie_id IS NULL OR b.especie_id IS NULL OR a.especie_id = b.especie_id)
           AND NOT EXISTS (
                 SELECT 1 FROM inventario_parnaoduplicado p
                  WHERE p.arvore_a_id = a.id AND p.arvore_b_id = b.id)
         {final}
    """  # noqa: S608 - só a subconsulta gerada pelo ORM é interpolada; valores vão como parâmetros
    return sql, [grau, raio_m, *sub_params, *sub_params]


def contar_pares_suspeitos(arvores: QuerySet, raio_m: float = RAIO_PADRAO_M) -> int:
    sql, params = _sql_pares(arvores, raio_m, "count(*)", "")
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchone()[0]


def pares_suspeitos(
    arvores: QuerySet, raio_m: float = RAIO_PADRAO_M, limite: int = 200
) -> list[dict]:
    """Pares de árvores ativas a até ``raio_m`` metros, com espécies compatíveis
    (iguais ou ao menos uma não identificada), excluindo pares já revisados."""
    sql, params = _sql_pares(
        arvores,
        raio_m,
        """a.id, b.id,
               ST_Distance(a.geom::geography, b.geom::geography) AS distancia,
               (a.especie_id IS NOT NULL AND a.especie_id = b.especie_id) AS mesma_especie""",
        "ORDER BY distancia LIMIT %s",
    )
    with connection.cursor() as cursor:
        cursor.execute(sql, [*params, limite])
        linhas = cursor.fetchall()
    pares = []
    for id_a, id_b, distancia, mesma_especie in linhas:
        # Vírgula decimal: o texto vai direto para a tela (pt-BR).
        criterios = [f"a {distancia:.1f}".replace(".", ",") + " m de distância"]
        criterios.append(
            "mesma espécie" if mesma_especie else "espécie não identificada em ao menos uma"
        )
        pares.append(
            {
                "arvore_a": id_a,
                "arvore_b": id_b,
                "distancia_m": round(distancia, 2),
                "criterio": "; ".join(criterios),
            }
        )
    return pares


@transaction.atomic
def fundir(manter: Arvore, descartar: Arvore, campos_da_outra: list[str]) -> Arvore:
    """Funde ``descartar`` em ``manter``. Os campos listados vêm de ``descartar``;
    histórico, medidas, identificadores, evidências e ocorrências passam para
    ``manter``. O registro descartado continua existindo, marcado como fundido
    e apontando para o resultante (CA-INV-007)."""
    manter = Arvore.objects.select_for_update().get(pk=manter.pk)
    descartar = Arvore.objects.select_for_update().get(pk=descartar.pk)
    for campo in campos_da_outra:
        if campo not in CAMPOS_FUSIONAVEIS:
            raise ValueError(f"Campo não fusionável: {campo}")
        if campo == "especie":
            manter.especie_id = descartar.especie_id
        else:
            setattr(manter, campo, getattr(descartar, campo))
    manter.save()

    Medida.objects.filter(arvore=descartar).update(arvore=manter)
    IdentificadorExterno.objects.filter(arvore=descartar).update(arvore=manter)
    Evidencia.objects.filter(arvore=descartar).update(arvore=manter)
    Ocorrencia.objects.filter(arvore=descartar).update(arvore=manter)

    descartar.situacao = SituacaoArvore.FUNDIDA
    descartar.fundida_em = manter
    descartar.save(update_fields=["situacao", "fundida_em", "atualizado_em"])
    return manter


def vizinhas_de_pontos(
    pontos: list[tuple[int, float, float]], raio_m: float, arvores: QuerySet | None = None
) -> dict[int, dict]:
    """Para cada ponto ``(chave, longitude, latitude)``, a árvore ativa mais próxima a até
    ``raio_m`` metros dentro de ``arvores`` (padrão: todas). Serve à importação, que aponta
    linhas novas coladas a árvores já cadastradas. Devolve ``{chave: {id, numero, distancia_m}}``
    só para os pontos que têm vizinha."""
    if not pontos:
        return {}
    base = Arvore.objects.all() if arvores is None else arvores
    visiveis = base.filter(situacao=SituacaoArvore.ATIVA, geom__isnull=False).values("id")
    sub_sql, sub_params = visiveis.query.get_compiler(connection=connection).as_sql()
    grau = raio_m / 100_000
    sql = f"""
        SELECT p.chave, v.id, v.numero, v.distancia
          FROM unnest(%s::int[], %s::float8[], %s::float8[]) AS p(chave, lon, lat)
          CROSS JOIN LATERAL (
                SELECT a.id, a.numero,
                       ST_Distance(a.geom::geography, pt.g::geography) AS distancia
                  FROM (SELECT ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326) AS g) pt
                  JOIN inventario_arvore a
                    ON a.geom && ST_Expand(pt.g, %s)
                   AND ST_DWithin(a.geom::geography, pt.g::geography, %s)
                 WHERE a.id IN ({sub_sql})
                 ORDER BY distancia
                 LIMIT 1) v
    """  # noqa: S608 - só a subconsulta gerada pelo ORM é interpolada; valores vão como parâmetros
    achadas = {}
    for inicio in range(0, len(pontos), 2000):
        bloco = pontos[inicio : inicio + 2000]
        parametros = [
            [p[0] for p in bloco],
            [p[1] for p in bloco],
            [p[2] for p in bloco],
            grau,
            raio_m,
            *sub_params,
        ]
        with connection.cursor() as cursor:
            cursor.execute(sql, parametros)
            for chave, id_, numero, distancia in cursor.fetchall():
                achadas[chave] = {"id": id_, "numero": numero, "distancia_m": round(distancia, 2)}
    return achadas
