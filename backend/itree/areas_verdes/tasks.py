"""Reimportação mensal das áreas verdes pela API oficial (RF-INT-005)."""

import logging

from celery import shared_task
from django.core.management import call_command

logger = logging.getLogger(__name__)


@shared_task
def reimportar_areas_verdes() -> None:
    """Roda ``importar_areas_verdes`` para os três tipos. A importação é atômica:
    se a API falhar, nada muda, a falha sobe para o Celery e a última importação
    continua antiga, o que faz o aviso de fonte desatualizada aparecer."""
    try:
        call_command("importar_areas_verdes", tipo="todos")
    except Exception:
        logger.exception("Falha ao reimportar as áreas verdes.")
        raise
