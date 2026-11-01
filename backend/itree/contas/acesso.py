"""Aplicação de permissões e de escopo territorial no servidor (RF-ACL-002/003)."""

from django.contrib.gis.db.models import Union
from django.contrib.gis.geos import MultiPolygon
from django.db.models import Q, QuerySet
from rest_framework.permissions import BasePermission

from itree.territorio.models import Territorio

from .models import Usuario


def requer(*permissoes: str) -> type[BasePermission]:
    """Permissão DRF: o usuário precisa de **todas** as permissões informadas."""

    class _Requer(BasePermission):
        message = "Você não tem permissão para esta ação."

        def has_permission(self, request, view) -> bool:
            usuario = request.user
            return bool(
                usuario
                and usuario.is_authenticated
                and all(usuario.tem_permissao(p) for p in permissoes)
            )

    _Requer.__name__ = f"Requer({', '.join(permissoes)})"
    return _Requer


def area_do_escopo(usuario: Usuario) -> MultiPolygon | None:
    """União das geometrias dos territórios do usuário; ``None`` se sem escopo."""
    area = Territorio.objects.filter(usuarios=usuario).aggregate(area=Union("geom"))["area"]
    if area is None:
        return None
    if area.geom_type == "Polygon":
        area = MultiPolygon(area, srid=area.srid)
    return area


def tem_escopo_municipal(usuario: Usuario) -> bool:
    return Territorio.objects.filter(usuarios=usuario, tipo="municipio").exists()


def filtrar_por_escopo(
    qs: QuerySet, usuario: Usuario, campo_geom: str = "geom", incluir_sem_geom: bool = False
) -> QuerySet:
    """Restringe ``qs`` aos registros cuja geometria intersecta o escopo do
    usuário. Usuário sem escopo não vê registro algum.

    Com ``incluir_sem_geom``, registros sem localização ficam visíveis só para
    quem tem escopo municipal (não há como saber a que área pertencem).
    """
    area = area_do_escopo(usuario)
    if area is None:
        return qs.none()
    condicao = Q(**{f"{campo_geom}__intersects": area})
    if incluir_sem_geom and tem_escopo_municipal(usuario):
        condicao |= Q(**{f"{campo_geom}__isnull": True})
    return qs.filter(condicao)


def ponto_no_escopo(usuario: Usuario, ponto) -> bool:
    area = area_do_escopo(usuario)
    return area is not None and area.intersects(ponto)
