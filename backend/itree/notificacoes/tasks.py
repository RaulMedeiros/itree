"""Retenção das notificações (Celery beat, diária)."""

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import Notificacao

logger = logging.getLogger(__name__)


@shared_task
def limpar_notificacoes_antigas() -> dict[str, int]:
    """Apaga as lidas há mais de ``NOTIFICACOES_RETENCAO_LIDAS_DIAS`` e as não lidas criadas
    há mais de ``NOTIFICACOES_RETENCAO_NAO_LIDAS_DIAS``."""
    agora = timezone.now()
    lidas, _ = Notificacao.objects.filter(
        lida_em__lt=agora - timedelta(days=settings.NOTIFICACOES_RETENCAO_LIDAS_DIAS)
    ).delete()
    nao_lidas, _ = Notificacao.objects.filter(
        lida_em__isnull=True,
        criado_em__lt=agora - timedelta(days=settings.NOTIFICACOES_RETENCAO_NAO_LIDAS_DIAS),
    ).delete()
    logger.info("Notificações apagadas: %s lidas, %s não lidas.", lidas, nao_lidas)
    return {"lidas": lidas, "nao_lidas": nao_lidas}
