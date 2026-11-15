"""Consultas sobre a iluminação pública usadas por outras partes do sistema.

O conflito poste × copa aqui é só **proximidade**: árvore ativa a menos de ``R`` metros de um
ponto de iluminação. O raio (``ILUMINACAO_RAIO_CONFLITO_M``) é provisório até a URBFOR e a SEINF
decidirem a regra (docs/decisoes/pendentes.md); nada aqui afirma que há dano ou risco.
"""

import re
import unicodedata

from django.conf import settings
from django.contrib.gis.db.models import PointField
from django.db.models import BooleanField, Exists, F, FloatField, Func, OuterRef, Subquery, Value
from django.db.models.query import QuerySet

from .models import LoteIluminacao, PontoIluminacao

# Distância máxima do "poste mais próximo" mostrado na ficha da árvore e da ocorrência.
RAIO_FICHA_M = 15.0
# 1 grau ≈ 111 km: o pré-filtro por caixa usa 100 km por grau, folgado de propósito.
METROS_POR_GRAU_FOLGADO = 100_000

# Faixas de altura de poste que a fonte traz (máximo da faixa, em metros): "até 5 m", "5 a 10 m"...
ALTURAS_MAXIMAS_M = (5, 10, 14, 17, 25)

_TIPO_RELACIONADO = re.compile(r"fia[cç][aã]o|ilumina|poste|rede el[eé]trica", re.IGNORECASE)


def raio_de_conflito_m() -> float:
    return float(settings.ILUMINACAO_RAIO_CONFLITO_M)


def resumo_da_iluminacao() -> dict | None:
    """Fonte, licença e data da última importação; ``None`` se nunca houve uma."""
    lote = LoteIluminacao.objects.order_by("-ingerido_em").first()
    if lote is None:
        return None
    return {
        "quantidade": PontoIluminacao.objects.count(),
        "fonte": lote.fonte,
        "fonte_url": lote.fonte_url,
        "licenca": lote.licenca,
        "data_referencia": lote.data_referencia,
        "ingerido_em": lote.ingerido_em,
    }


def tipo_de_ocorrencia_relacionado(nome: str) -> bool:
    """O tipo (catálogo configurável) fala de fiação, rede elétrica, poste ou iluminação?"""
    sem_acento = "".join(
        c for c in unicodedata.normalize("NFD", nome or "") if unicodedata.category(c) != "Mn"
    )
    return bool(_TIPO_RELACIONADO.search(nome or "") or _TIPO_RELACIONADO.search(sem_acento))


class DistanciaM(Func):
    """Distância em metros entre duas geometrias 4326 (geografia, esferoide)."""

    output_field = FloatField()

    def as_sql(self, compiler, connection, **extra):
        (a, pa), (b, pb) = (compiler.compile(e) for e in self.get_source_expressions())
        return f"ST_Distance(({a})::geography, ({b})::geography)", [*pa, *pb]


class NoRaio(Func):
    """``a`` a até ``raio_m`` metros de ``b``: caixa (índice espacial) e, depois, a distância."""

    output_field = BooleanField()

    def __init__(self, a, b, raio_m: float):
        super().__init__(a, b)
        self.raio_m = float(raio_m)

    def as_sql(self, compiler, connection, **extra):
        (a, pa), (b, pb) = (compiler.compile(e) for e in self.get_source_expressions())
        grau = self.raio_m / METROS_POR_GRAU_FOLGADO
        sql = (
            f"(({a}) && ST_Expand(({b}), %s)"
            f" AND ST_DWithin(({a})::geography, ({b})::geography, %s))"
        )
        return sql, [*pa, *pb, grau, *pa, *pb, self.raio_m]


def _pontos_no_raio(origem, raio_m: float, altura_max_m: float | None = None) -> QuerySet:
    pontos = PontoIluminacao.objects.filter(NoRaio(F("geom"), origem, raio_m))
    if altura_max_m is not None:
        pontos = pontos.filter(altura_poste_max_m=altura_max_m)
    return pontos


def arvores_em_conflito(
    arvores: QuerySet, raio_m: float | None = None, altura_max_m: float | None = None
) -> QuerySet:
    """Árvores de ``arvores`` (já restritas ao escopo) com ponto de iluminação a até ``raio_m``.

    Cada árvore sai anotada com ``poste_id`` e ``poste_distancia_m`` do ponto mais próximo (entre
    os da altura pedida, se houver filtro), ordenadas da mais próxima para a mais distante.
    """
    raio = raio_de_conflito_m() if raio_m is None else raio_m
    no_raio = _pontos_no_raio(OuterRef("geom"), raio, altura_max_m)
    mais_proximo = no_raio.annotate(d=DistanciaM(F("geom"), OuterRef("geom"))).order_by(
        "d", "codigo"
    )
    return (
        arvores.filter(geom__isnull=False)
        .filter(Exists(no_raio))
        .annotate(
            poste_id=Subquery(mais_proximo.values("id")[:1]),
            poste_distancia_m=Subquery(mais_proximo.values("d")[:1]),
        )
        .order_by("poste_distancia_m", "numero")
    )


def dados_do_poste(ponto: PontoIluminacao, distancia_m: float) -> dict:
    return {
        "codigo": ponto.codigo,
        "distancia_m": round(float(distancia_m), 1),
        "tipo": ponto.poste_tipo,
        "altura_min_m": ponto.altura_poste_min_m,
        "altura_max_m": ponto.altura_poste_max_m,
        "logradouro": ponto.logradouro,
    }


def poste_mais_proximo(geom, raio_m: float = RAIO_FICHA_M) -> dict | None:
    """Ponto de iluminação mais próximo de ``geom`` a até ``raio_m`` metros, ou ``None``.

    Dado de referência público: não depende do escopo de quem consulta.
    """
    if geom is None:
        return None
    origem = Value(geom, output_field=PointField(srid=4326))
    ponto = (
        _pontos_no_raio(origem, raio_m)
        .annotate(d=DistanciaM(F("geom"), origem))
        .order_by("d", "codigo")
        .first()
    )
    return dados_do_poste(ponto, ponto.d) if ponto else None
