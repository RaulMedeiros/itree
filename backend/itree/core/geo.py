import re

from django.contrib.gis.geos import Point, Polygon

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


# Mesmo limite do codificador da interface (apps/web/src/mapa/areaUrl.ts).
MAXIMO_VERTICES_AREA = 200
_PARTE_AREA = re.compile(r"-?[0-9a-z]+")


def decodificar_area(texto: str) -> Polygon:
    """Polígono (EPSG:4326) a partir do formato compacto do parâmetro ``area`` do mapa.

    Cada coordenada em microgrados, o primeiro vértice absoluto e os demais como diferença
    do anterior, em base 36 e separados por ``_`` (ver ``areaUrl.ts``). O vértice de
    fechamento não vem no texto. Texto malformado ou polígono inválido levanta ``ValueError``
    com uma mensagem para quem chamou.
    """
    partes = texto.split("_")
    if len(partes) % 2 != 0 or len(partes) < 6 or len(partes) > MAXIMO_VERTICES_AREA * 2:
        raise ValueError(f"Área inválida: informe de 3 a {MAXIMO_VERTICES_AREA} vértices.")
    vertices: list[tuple[float, float]] = []
    x = y = 0
    for i in range(0, len(partes), 2):
        if not _PARTE_AREA.fullmatch(partes[i]) or not _PARTE_AREA.fullmatch(partes[i + 1]):
            raise ValueError("Área inválida: o texto não está no formato do mapa.")
        x += int(partes[i], 36)
        y += int(partes[i + 1], 36)
        longitude, latitude = x / 1_000_000, y / 1_000_000
        if abs(longitude) > 180 or abs(latitude) > 90:
            raise ValueError("Área inválida: coordenadas fora do intervalo.")
        vertices.append((longitude, latitude))
    poligono = Polygon([*vertices, vertices[0]], srid=4326)
    if not poligono.valid:
        raise ValueError(f"Área inválida: {poligono.valid_reason}.")
    return poligono
