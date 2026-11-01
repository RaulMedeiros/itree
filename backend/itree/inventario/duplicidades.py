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


def pares_suspeitos(
    arvores: QuerySet, raio_m: float = RAIO_PADRAO_M, limite: int = 200
) -> list[dict]:
    """Pares de árvores ativas a até ``raio_m`` metros, com espécies compatíveis
    (iguais ou ao menos uma não identificada), excluindo pares já revisados."""
    ids = list(
        arvores.filter(situacao=SituacaoArvore.ATIVA, geom__isnull=False).values_list(
            "id", flat=True
        )
    )
    if len(ids) < 2:
        return []
    # Pré-filtro por caixa (~1e-5 grau ≈ 1,1 m no equador) e distância exata em geografia.
    grau = raio_m / 100_000
    sql = """
        SELECT a.id, b.id,
               ST_Distance(a.geom::geography, b.geom::geography) AS distancia,
               (a.especie_id IS NOT NULL AND a.especie_id = b.especie_id) AS mesma_especie
          FROM inventario_arvore a
          JOIN inventario_arvore b
            ON a.id < b.id
           AND b.geom && ST_Expand(a.geom, %s)
           AND ST_DWithin(a.geom::geography, b.geom::geography, %s)
         WHERE a.id = ANY(%s) AND b.id = ANY(%s)
           AND (a.especie_id IS NULL OR b.especie_id IS NULL OR a.especie_id = b.especie_id)
           AND NOT EXISTS (
                 SELECT 1 FROM inventario_parnaoduplicado p
                  WHERE p.arvore_a_id = a.id AND p.arvore_b_id = b.id)
         ORDER BY distancia
         LIMIT %s
    """
    with connection.cursor() as cursor:
        cursor.execute(sql, [grau, raio_m, ids, ids, limite])
        linhas = cursor.fetchall()
    pares = []
    for id_a, id_b, distancia, mesma_especie in linhas:
        criterios = [f"a {distancia:.1f} m de distância"]
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
