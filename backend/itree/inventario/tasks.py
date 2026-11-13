import logging
import time
from datetime import timedelta

import pghistory
from celery import shared_task
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from . import importacao, referencias
from .models import Especie

logger = logging.getLogger(__name__)


@shared_task
def atualizar_referencias_especie(especie_id: str) -> str:
    especie = Especie.objects.filter(pk=especie_id).first()
    if especie is None:
        return "inexistente"
    return referencias.atualizar(especie).referencias_situacao


@shared_task
def atualizar_referencias_antigas() -> dict:
    """Reconsulta (mensal, M-09) as espécies ativas cujas referências nunca foram
    consultadas ou têm mais de REFERENCIAS_IDADE_MAXIMA_DIAS dias. Artigos e
    imagens mudam. Há pausa entre consultas (cortesia com as APIs públicas) e
    a falha de uma espécie não interrompe as demais."""
    limite = timezone.now() - timedelta(days=settings.REFERENCIAS_IDADE_MAXIMA_DIAS)
    ids = list(
        Especie.objects.filter(ativa=True)
        .filter(
            Q(referencias_consultadas_em__isnull=True) | Q(referencias_consultadas_em__lt=limite)
        )
        .order_by("referencias_consultadas_em", "nome_cientifico")
        .values_list("pk", flat=True)
    )
    resultado = {"selecionadas": len(ids), "atualizadas": 0, "falhas": 0}
    for i, pk in enumerate(ids):
        if i:
            time.sleep(settings.REFERENCIAS_INTERVALO_SEGUNDOS)
        try:
            especie = Especie.objects.get(pk=pk)
            with pghistory.context(evento="referencias_especie"):
                referencias.atualizar(especie)
            resultado["atualizadas"] += 1
        except Exception:  # noqa: BLE001 - uma espécie não derruba o lote
            logger.exception("Falha ao atualizar as referências da espécie %s", pk)
            resultado["falhas"] += 1
    return resultado


@shared_task
def confirmar_importacao(lote_id: str) -> None:
    """Confirma em segundo plano um lote de importação grande. Reentrega retoma do ponto gravado."""
    importacao.executar_confirmacao(lote_id)
