from celery import shared_task

from . import instantaneos


@shared_task
def registrar_indicadores() -> int:
    """Registro diário dos instantâneos da visão geral (M-11)."""
    return instantaneos.registrar()
