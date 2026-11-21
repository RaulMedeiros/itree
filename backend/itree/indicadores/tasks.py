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


@shared_task
def renovar_fontes_populacao() -> list[dict]:
    """Confere todo mês as fontes de população, renda, estimativa e IDH por bairro e reimporta o
    que mudou (ano ou versão nova). Cada execução é registrada; a falha de uma fonte não impede
    as outras e aparece no aviso de fonte desatualizada."""
    from . import populacao

    return populacao.renovar(origem="agendada")


@shared_task
def calcular_3_30_300() -> dict:
    """Recalcula a regra 3-30-300 por bairro (mensal e depois das importações). Cálculo pesado:
    sempre aqui, nunca na requisição."""
    from . import regra_3_30_300

    return regra_3_30_300.calcular()
