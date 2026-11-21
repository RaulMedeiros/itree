"""Reimportação mensal dos dados imobiliários por bairro e do macrozoneamento."""

import logging

from celery import shared_task
from django.core.management import call_command

logger = logging.getLogger(__name__)


@shared_task
def reimportar_dados_imobiliarios() -> None:
    """IPTU e áreas edificadas por bairro (SEFIN) e macrozoneamento (SEUMA), pelo Fortaleza em
    Mapas. A falha de uma fonte não impede a outra; ao fim, a regra 3-30-300 é recalculada."""
    falhou = []
    for comando in ("importar_indicadores_sefin", "importar_macrozoneamento"):
        try:
            call_command(comando)
        except Exception:
            logger.exception("Falha em %s.", comando)
            falhou.append(comando)
    from itree.indicadores.tasks import calcular_3_30_300

    calcular_3_30_300.delay()
    if falhou:
        raise RuntimeError("Falha ao reimportar: " + ", ".join(falhou))
