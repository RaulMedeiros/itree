"""Escopo territorial dos alertas (RF-ACL-003).

Alertas de foco de calor usam o escopo do usuário com um buffer (setting
``ALERTAS_FOCOS_RAIO_AREA_VERDE_KM``): um foco logo além do limite, junto de um
parque ou unidade de conservação, interessa a quem cuida da área vizinha. Os
demais alertas seguem o escopo exato.
"""

from django.conf import settings
from django.db.models import Q, QuerySet

from itree.contas.acesso import area_do_escopo
from itree.contas.models import Usuario
from itree.core.geo import ampliar

from .models import AlertaAmbiental, TipoAlerta


def _areas(usuario: Usuario):
    area = area_do_escopo(usuario)
    if area is None:
        return None, None
    return area, ampliar(area, settings.ALERTAS_FOCOS_RAIO_AREA_VERDE_KM * 1000)


def filtrar_alertas_por_escopo(qs: QuerySet, usuario: Usuario) -> QuerySet:
    """Alertas do escopo do usuário; focos de calor também até o buffer do escopo."""
    area, ampla = _areas(usuario)
    if area is None:
        return qs.none()
    return qs.filter(
        Q(geom__intersects=area) | Q(tipo=TipoAlerta.FOCO_CALOR, geom__intersects=ampla)
    )


def alerta_no_escopo(alerta: AlertaAmbiental, usuario: Usuario) -> bool:
    area, ampla = _areas(usuario)
    if area is None:
        return False
    if area.intersects(alerta.geom):
        return True
    return alerta.tipo == TipoAlerta.FOCO_CALOR and ampla.intersects(alerta.geom)
