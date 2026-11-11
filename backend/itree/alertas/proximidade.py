"""Árvores e ocorrências próximas de um alerta (RF-ALR; crítica C-27/C-28).

A distância é geodésica, em metros (``geography``), medida até o ponto ou o
polígono do alerta; árvore dentro do polígono está a 0 m. Tudo respeita o
escopo territorial de quem consulta.
"""

from django.contrib.gis.db.models import GeometryField
from django.db.models import BooleanField, Count, F, FloatField, Func, OuterRef, Subquery, Value

from itree.contas.acesso import filtrar_por_escopo
from itree.inventario.models import Arvore, SituacaoArvore
from itree.ocorrencias.models import ESTADOS_FINAIS, Ocorrencia

RAIO_PADRAO_M = 100
RAIO_MAXIMO_M = 1000


class _Geografia(Func):
    """``ST_*`` sobre ``geography``: os argumentos geométricos (SRID 4326) são convertidos."""

    def as_sql(self, compiler, connection, **extra):
        sql, params = [], []
        for expressao in self.source_expressions:
            parte, p = compiler.compile(expressao)
            sql.append(f"({parte})::geography" if self._eh_geom(expressao) else parte)
            params.extend(p)
        return f"{self.function}({', '.join(sql)})", params

    @staticmethod
    def _eh_geom(expressao) -> bool:
        try:
            return isinstance(expressao.output_field, GeometryField)
        except Exception:  # noqa: BLE001 - expressões sem tipo resolvido (OuterRef) são geometrias
            return True


class DentroDoRaio(_Geografia):
    function = "ST_DWithin"
    output_field = BooleanField()


class DistanciaM(_Geografia):
    function = "ST_Distance"
    output_field = FloatField()


def normalizar_raio(valor) -> int:
    """Raio em metros a partir do parâmetro da requisição (padrão 100, máximo 1000)."""
    if valor in (None, ""):
        return RAIO_PADRAO_M
    try:
        raio = int(float(valor))
    except (TypeError, ValueError):
        raise ValueError("Informe o raio em metros, entre 1 e 1000.") from None
    if not 1 <= raio <= RAIO_MAXIMO_M:
        raise ValueError("Informe o raio em metros, entre 1 e 1000.")
    return raio


def arvores_do_raio(usuario, geom, raio: int):
    """Árvores ativas no escopo do usuário a até ``raio`` m de ``geom``, mais próximas primeiro."""
    qs = filtrar_por_escopo(
        Arvore.objects.filter(situacao=SituacaoArvore.ATIVA, geom__isnull=False), usuario
    )
    return (
        qs.filter(
            DentroDoRaio(
                F("geom"), Value(geom, output_field=GeometryField(srid=4326)), Value(float(raio))
            )
        )
        .annotate(
            distancia_m=DistanciaM(F("geom"), Value(geom, output_field=GeometryField(srid=4326)))
        )
        .order_by("distancia_m", "numero")
    )


def anotar_contagens(qs_alertas, usuario, raio: int):
    """Acrescenta ``arvores_proximas`` e ``ocorrencias_proximas`` (abertas) aos alertas."""
    arvores = filtrar_por_escopo(
        Arvore.objects.filter(situacao=SituacaoArvore.ATIVA, geom__isnull=False), usuario
    )
    ocorrencias = filtrar_por_escopo(Ocorrencia.objects.exclude(estado__in=ESTADOS_FINAIS), usuario)

    def contagem(base):
        return Subquery(
            base.filter(DentroDoRaio(F("geom"), OuterRef("geom"), Value(float(raio))))
            .order_by()
            .values(g=Value(1))
            .annotate(c=Count("pk"))
            .values("c")
        )

    return qs_alertas.annotate(
        arvores_proximas=Coalesce0(contagem(arvores)),
        ocorrencias_proximas=Coalesce0(contagem(ocorrencias)),
    )


def Coalesce0(expressao):  # noqa: N802 - atalho local
    from django.db.models import IntegerField
    from django.db.models.functions import Coalesce

    return Coalesce(expressao, Value(0), output_field=IntegerField())
