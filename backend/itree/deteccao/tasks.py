"""Tarefas Celery da detecção automática."""

from celery import shared_task

from . import servico


@shared_task
def processar_lote(lote_id: str) -> str | None:
    """Processa em segundo plano um lote grande. Reentrega retoma do ponto gravado."""
    lote = servico.processar(lote_id)
    return lote.situacao if lote else None
