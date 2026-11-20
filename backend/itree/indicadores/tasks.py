from celery import shared_task

from . import instantaneos


@shared_task
def registrar_indicadores() -> int:
    """Registro diário dos instantâneos da visão geral (M-11)."""
    return instantaneos.registrar()


@shared_task
def reimportar_ilha_calor() -> None:
    """Reimportação anual da ilha de calor por bairro (UrbVerde). Sem ``URBVERDE_GRAVAR_VALORES``
    o comando só calcula e avisa, sem gravar. Falha do WCS sobe para o Celery e os valores
    anteriores continuam."""
    import logging

    from django.core.management import call_command

    try:
        call_command("importar_ilha_calor_urbverde")
    except Exception:
        logging.getLogger(__name__).exception("Falha ao reimportar a ilha de calor.")
        raise
