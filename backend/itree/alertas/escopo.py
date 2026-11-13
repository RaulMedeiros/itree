"""Escopo territorial dos alertas (RF-ACL-003).

Alertas de foco de calor usam o escopo do usuário com um buffer (o maior dos raios
``ALERTAS_FOCOS_RAIO_*_KM``): um foco logo além do limite, junto de um parque ou unidade de
conservação, interessa a quem cuida da área vizinha. Os demais alertas seguem o escopo exato.
"""

from django.conf import settings
from django.db.models import Q, QuerySet

from itree.contas.acesso import area_do_escopo
from itree.contas.models import Usuario
from itree.core.geo import ampliar

from .models import AlertaAmbiental, TipoAlerta
from .proximidade import raio_maximo_km


def _areas(usuario: Usuario):
    area = area_do_escopo(usuario)
    if area is None:
        return None, None
    return area, ampliar(area, raio_maximo_km() * 1000)


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


def filtrar_supressao_por_escopo(qs: QuerySet, usuario: Usuario) -> QuerySet:
    """Polígonos do PRODES (camada de referência) no escopo do usuário, ampliado pelo buffer
    ``PRODES_CAATINGA_BUFFER_KM``, o mesmo da ingestão."""
    area = area_do_escopo(usuario)
    if area is None:
        return qs.none()
    return qs.filter(geom__intersects=ampliar(area, settings.PRODES_CAATINGA_BUFFER_KM * 1000))
