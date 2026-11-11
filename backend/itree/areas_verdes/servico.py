"""Consultas de áreas verdes usadas por outras partes do sistema."""

from django.conf import settings
from django.db.models import Case, IntegerField, Max, Value, When
from django.utils import timezone

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


def situacao_da_fonte(agora=None) -> dict:
    """Estado da última importação das áreas verdes (RF-INT-005).

    ``desatualizada`` vale quando a última importação tem mais de
    ``AREAS_VERDES_IDADE_MAXIMA_DIAS`` dias. Sem nenhuma área importada, não há
    o que sinalizar: ``ultima_importacao`` e ``dias`` ficam vazios.
    """
    ultima = AreaVerde.objects.aggregate(m=Max("ingerido_em"))["m"]
    limite = settings.AREAS_VERDES_IDADE_MAXIMA_DIAS
    if ultima is None:
        return {
            "ultima_importacao": None,
            "dias": None,
            "limite_dias": limite,
            "desatualizada": False,
        }
    dias = ((agora or timezone.now()) - ultima).days
    return {
        "ultima_importacao": ultima,
        "dias": dias,
        "limite_dias": limite,
        "desatualizada": dias > limite,
    }
