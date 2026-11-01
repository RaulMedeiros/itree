from celery import shared_task

from . import referencias
from .models import Especie


@shared_task
def atualizar_referencias_especie(especie_id: str) -> str:
    especie = Especie.objects.filter(pk=especie_id).first()
    if especie is None:
        return "inexistente"
    return referencias.atualizar(especie).referencias_situacao
