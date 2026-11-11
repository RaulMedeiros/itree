from django.contrib.gis.geos import Point

# SIRGAS 2000 / UTM 24S: cálculos métricos em Fortaleza (ADR-0001 §2.3).
SRID_METRICO = 31984


def ponto(longitude: float, latitude: float) -> Point:
    return Point(float(longitude), float(latitude), srid=4326)


def bairro_do_ponto(geom):
    """Bairro que contém o ponto, ou ``None``."""
    from itree.territorio.models import Territorio, TipoTerritorio

    if geom is None:
        return None
    return Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO, geom__contains=geom).first()


def ampliar(geom, metros: float):
    """Cópia de ``geom`` (EPSG:4326) ampliada em ``metros`` em todas as direções.

    O buffer é calculado em metros, no SRC métrico de Fortaleza, e devolvido em 4326.
    """
    if metros <= 0:
        return geom
    metrica = geom.transform(SRID_METRICO, clone=True)
    ampliada = metrica.buffer(metros)
    ampliada.transform(4326)
    return ampliada
