"""Reimportação mensal dos pontos de iluminação pública."""

import logging

from celery import shared_task
from django.core.management import call_command

logger = logging.getLogger(__name__)


@shared_task
def reimportar_iluminacao_publica() -> None:
    """Roda ``importar_iluminacao_publica`` pela fonte oficial. A importação é atômica: se o
    download ou a leitura falharem, nada muda, a falha sobe para o Celery e os pontos anteriores
    continuam."""
    try:
        call_command("importar_iluminacao_publica")
    except Exception:
        logger.exception("Falha ao reimportar a iluminação pública.")
        raise
