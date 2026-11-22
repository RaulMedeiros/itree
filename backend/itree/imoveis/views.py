"""Zona do macrozoneamento de um ponto ou de uma árvore (só leitura), com escopo territorial."""

from django.contrib.gis.geos import Point
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from itree.contas.acesso import area_do_escopo, filtrar_por_escopo, requer
from itree.core.parametros import uuid_do_parametro
from itree.inventario.models import Arvore

from . import macrozoneamento

ZonaSerializer = inline_serializer(
    "ZonaMacrozoneamento",
    {
        "zona": serializers.DictField(
            allow_null=True,
            help_text="Zona (nome, sigla, parâmetros de ocupação); nulo fora das zonas.",
        ),
        "fonte": serializers.CharField(),
        "fonte_url": serializers.CharField(),
        "licenca": serializers.CharField(),
        "data_referencia": serializers.DateField(),
    },
)


def _coordenada(params, nome: str, limite: float) -> float:
    try:
        valor = float(str(params.get(nome, "")).replace(",", "."))
    except ValueError:
        valor = float("nan")
    if not -limite <= valor <= limite:
        raise ValidationError({nome: [f"Informe {nome} em graus decimais."]})
    return valor


@extend_schema(
    operation_id="macrozoneamento_zona",
    parameters=[
        OpenApiParameter("arvore", str, description="Id de uma árvore (usa a localização dela)."),
        OpenApiParameter("lat", float, description="Latitude (com lon, no lugar de arvore)."),
        OpenApiParameter("lon", float),
    ],
    responses=ZonaSerializer,
)
@api_view(["GET"])
@permission_classes([requer("mapa.ler")])
def zona(request: Request):
    """Zona do Macrozoneamento Urbano (SEUMA, 2022) que contém o ponto ou a árvore. Só leitura;
    o painel da árvore usa este endpoint. Ponto fora do escopo de quem consulta dá 403."""
    if "arvore" in request.query_params:
        arvore = filtrar_por_escopo(
            Arvore.objects.filter(pk=uuid_do_parametro(request.query_params["arvore"], "arvore")),
            request.user,
        ).first()
        if arvore is None or arvore.geom is None:
            raise NotFound("Árvore não encontrada ou sem localização.")
        lon, lat = arvore.geom.x, arvore.geom.y
    else:
        lat = _coordenada(request.query_params, "lat", 90)
        lon = _coordenada(request.query_params, "lon", 180)
        area = area_do_escopo(request.user)
        if area is None or not area.intersects(Point(lon, lat, srid=4326)):
            raise PermissionDenied("Este ponto está fora do seu escopo.")
    macrozona = macrozoneamento.zona_do_ponto(lon, lat)
    return Response(
        {
            "zona": None
            if macrozona is None
            else {
                "id": str(macrozona.pk),
                "nome": macrozona.nome,
                "sigla": macrozona.sigla,
                "parametros": macrozona.parametros,
            },
            "fonte": macrozoneamento.FONTE,
            "fonte_url": macrozoneamento.URL_PAGINA,
            "licenca": macrozoneamento.LICENCA,
            "data_referencia": macrozoneamento.DATA_REFERENCIA,
        }
    )
