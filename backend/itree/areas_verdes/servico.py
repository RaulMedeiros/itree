"""Consultas de áreas verdes usadas por outras partes do sistema."""

from django.db.models import Case, IntegerField, Value, When

from .models import AreaVerde, TipoAreaVerde

# Quando há sobreposição (praça dentro de uma APA, por exemplo), vale a mais
# específica: praça, depois parque, depois unidade de conservação.
_PRIORIDADE = Case(
    When(tipo=TipoAreaVerde.PRACA, then=Value(0)),
    When(tipo=TipoAreaVerde.PARQUE, then=Value(1)),
    default=Value(2),
    output_field=IntegerField(),
)


def area_verde_do_ponto(ponto) -> AreaVerde | None:
    """Área verde que contém ``ponto`` (interseção espacial), ou ``None``.

    Dado de referência público: não depende do escopo de quem consulta, que
    já foi aplicado à árvore. Em caso de sobreposição, vence a mais específica
    e, entre iguais, a menor.
    """
    if ponto is None:
        return None
    return (
        AreaVerde.objects.filter(geom__intersects=ponto)
        .annotate(prioridade=_PRIORIDADE)
        .order_by("prioridade", "area_m2", "nome")
        .only("id", "nome", "tipo")
        .first()
    )
