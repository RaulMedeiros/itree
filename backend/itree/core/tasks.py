"""Tarefas em segundo plano do núcleo."""

from celery import shared_task

from .lote import executar_operacao


@shared_task
def executar_operacao_em_lote(operacao_id: str) -> None:
    """Executa uma ação em lote grande (M-26). Reentrega de operação já iniciada é ignorada."""
    executar_operacao(operacao_id)
