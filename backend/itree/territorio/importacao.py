"""Lógica compartilhada pelos comandos de importação de territórios.

Mantém num só lugar a normalização da geometria (sempre MultiPolygon em WGS 84),
a gravação idempotente por (tipo, código) e a criação do município pela união
das geometrias importadas.
"""

from django.contrib.gis.geos import GEOSGeometry, MultiPolygon
from django.core.management.base import CommandError

from itree.territorio.models import Territorio, TipoTerritorio


def multipoligono(geom: GEOSGeometry) -> MultiPolygon:
    if geom.geom_type == "Polygon":
        return MultiPolygon(geom, srid=geom.srid)
    if geom.geom_type == "MultiPolygon":
        return geom
    raise CommandError(f"Geometria {geom.geom_type} não é polígono.")


def geometria_valida(geom: GEOSGeometry) -> GEOSGeometry:
    """Corrige geometrias inválidas (autointerseção) sem mudar o SRID."""
    return geom if geom.valid else geom.buffer(0)


def gravar_territorio(
    tipo: str,
    codigo: str,
    nome: str,
    geom: GEOSGeometry,
    comuns: dict,
    metadados: dict,
    pai: Territorio | None = None,
) -> tuple[Territorio, bool]:
    """Cria ou atualiza o território pelo par (tipo, código), com a proveniência."""
    defaults = {**comuns, "nome": nome, "geom": multipoligono(geom), "metadados": metadados}
    if pai is not None:
        defaults["pai"] = pai
    return Territorio.objects.update_or_create(tipo=tipo, codigo=codigo, defaults=defaults)


def obter_ou_criar_municipio(
    nome: str, importados: list[Territorio], comuns: dict, src_original, escrever=None
) -> Territorio:
    """Devolve o município existente ou o cria pela união dos territórios importados."""
    existente = Territorio.objects.filter(tipo=TipoTerritorio.MUNICIPIO, nome=nome).first()
    if existente:
        return existente
    uniao = importados[0].geom
    for t in importados[1:]:
        uniao = uniao.union(t.geom)
    if escrever:
        escrever(f"Município {nome} criado pela união de {len(importados)} territórios.")
    return Territorio.objects.create(
        tipo=TipoTerritorio.MUNICIPIO,
        codigo=nome.lower(),
        nome=nome,
        geom=multipoligono(uniao),
        metadados={
            "src_original": src_original,
            "derivado": "união dos territórios importados",
        },
        **comuns,
    )
