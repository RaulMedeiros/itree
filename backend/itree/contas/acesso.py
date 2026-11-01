"""Aplicação de permissões e de escopo territorial no servidor (RF-ACL-002/003)."""

from contextvars import ContextVar

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


# Cache por requisição: o painel e a qualidade consultam o escopo várias vezes
# na mesma requisição, e a união das geometrias custa caro. Fora de uma
# requisição (testes de serviço, tarefas Celery) não há cache.
_cache_escopo: ContextVar[dict | None] = ContextVar("itree_cache_escopo", default=None)


class CacheEscopoMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = _cache_escopo.set({})
        try:
            return self.get_response(request)
        finally:
            _cache_escopo.reset(token)


def _memorizado(chave: tuple, calcular):
    cache = _cache_escopo.get()
    if cache is None:
        return calcular()
    if chave not in cache:
        cache[chave] = calcular()
    return cache[chave]


def limpar_cache_escopo() -> None:
    """Chamar depois de alterar o escopo de alguém dentro da mesma requisição."""
    cache = _cache_escopo.get()
    if cache is not None:
        cache.clear()


def _calcular_area(usuario: Usuario) -> MultiPolygon | None:
    area = Territorio.objects.filter(usuarios=usuario).aggregate(area=Union("geom"))["area"]
    if area is None:
        return None
    if area.geom_type == "Polygon":
        area = MultiPolygon(area, srid=area.srid)
    return area


def area_do_escopo(usuario: Usuario) -> MultiPolygon | None:
    """União das geometrias dos territórios do usuário; ``None`` se sem escopo."""
    return _memorizado(("area", usuario.pk), lambda: _calcular_area(usuario))


def tem_escopo_municipal(usuario: Usuario) -> bool:
    return _memorizado(
        ("municipal", usuario.pk),
        lambda: Territorio.objects.filter(usuarios=usuario, tipo="municipio").exists(),
    )


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
