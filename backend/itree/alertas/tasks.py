"""Ingestão periódica (Celery beat). As fontes ficam em ALERTAS_FONTES, um JSON
{"inpe_focos": "<url>", "inpe_deter": "<url>"}; fontes sem URL não rodam."""

import logging

from celery import shared_task
from django.conf import settings

from . import fontes

logger = logging.getLogger(__name__)


@shared_task
def ingerir_fontes_configuradas() -> list[dict]:
    resultados = []
    for fonte, url in (settings.ALERTAS_FONTES or {}).items():
        try:
            conteudo = fontes.baixar(url)
        except Exception as exc:  # noqa: BLE001 - registrar e seguir para a próxima fonte
            ingestao = fontes.IngestaoAlertas.objects.create(fonte=fonte, origem=url, erro=str(exc))
            logger.warning("Falha ao baixar %s: %s", fonte, exc)
        else:
            ingestao = fontes.ingerir(fonte, conteudo, url)
        resultados.append({"fonte": fonte, "sucesso": ingestao.sucesso, "novos": ingestao.novos})
    return resultados
