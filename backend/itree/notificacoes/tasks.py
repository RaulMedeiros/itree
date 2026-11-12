"""Retenção das notificações (Celery beat, diária)."""

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail
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


def montar_email(notificacao: Notificacao) -> tuple[str, str]:
    """Assunto e corpo do e-mail de uma notificação."""
    linhas = [notificacao.titulo]
    if notificacao.texto:
        linhas.append(notificacao.texto)
    if notificacao.link and settings.WEB_URL_PUBLICA:
        linhas.append(f"Abrir no iTree: {settings.WEB_URL_PUBLICA}{notificacao.link}")
    linhas.append(
        "Você recebe este e-mail porque escolheu esse aviso em Minha conta > Notificações."
    )
    return f"iTree: {notificacao.titulo}", "\n\n".join(linhas)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def enviar_email_notificacao(self, notificacao_id: str) -> bool:
    """Envia o e-mail de uma notificação, uma única vez (reexecução não duplica)."""
    n = Notificacao.objects.select_related("usuario").filter(pk=notificacao_id).first()
    if n is None or n.email_enviado_em is not None or not n.usuario.email:
        return False
    assunto, corpo = montar_email(n)
    try:
        send_mail(assunto, corpo, settings.DEFAULT_FROM_EMAIL, [n.usuario.email])
    except Exception as erro:  # noqa: BLE001 - falha de SMTP é tentada de novo
        logger.warning("E-mail da notificação %s falhou: %s", notificacao_id, erro)
        raise self.retry(exc=erro) from erro
    Notificacao.objects.filter(pk=n.pk).update(email_enviado_em=timezone.now())
    return True


def enfileirar_emails(ids: list[str]) -> None:
    """Melhor esforço: sem fila disponível, a notificação continua no sino."""
    for i in ids:
        try:
            enviar_email_notificacao.delay(i)
        except Exception:  # noqa: BLE001 - broker fora do ar não pode impedir o evento
            logger.warning("Fila indisponível; e-mail da notificação %s não enviado.", i)
