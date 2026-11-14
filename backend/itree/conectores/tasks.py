"""Tarefas Celery dos conectores (RF-INT-006)."""

import logging

from celery import shared_task

from . import servico
from .models import ExecucaoConector, OrigemExecucao

logger = logging.getLogger(__name__)


@shared_task
def sincronizar_conector(execucao_id: int) -> bool | None:
    """Roda uma execução já aberta (por ``servico.iniciar_execucao``)."""
    execucao = (
        ExecucaoConector.objects.select_related("conector", "usuario")
        .filter(pk=execucao_id, concluida_em__isnull=True)
        .first()
    )
    if execucao is None:
        return None
    return servico.executar(execucao).sucesso


def enfileirar(execucao: ExecucaoConector) -> None:
    """Põe a execução na fila; sem fila, o registro não pode ficar "sincronizando"."""
    try:
        sincronizar_conector.delay(execucao.pk)
    except Exception:  # noqa: BLE001
        logger.exception("Não foi possível enfileirar a execução %s", execucao.pk)
        execucao.erro = "Não foi possível colocar a sincronização na fila. Tente novamente."
        execucao.concluida_em = execucao.iniciada_em
        execucao.save(update_fields=["erro", "concluida_em"])


@shared_task
def disparar_conectores_vencidos() -> int:
    """Beat (de hora em hora): abre e enfileira a execução dos conectores vencidos pela
    periodicidade. Conector já em execução é pulado."""
    disparados = 0
    for conector in servico.conectores_vencidos():
        try:
            execucao = servico.iniciar_execucao(conector, origem=OrigemExecucao.AGENDADA)
        except servico.ExecucaoEmAndamento:
            continue
        enfileirar(execucao)
        disparados += 1
    return disparados
