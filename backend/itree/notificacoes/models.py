"""Notificações por usuário (RF-SHELL-002): o que mudou e merece atenção."""

from django.conf import settings
from django.db import models

from itree.core.models import ModeloBase


class TipoNotificacao(models.TextChoices):
    TAREFA_ATRIBUIDA = "tarefa_atribuida", "Tarefa atribuída"
    TAREFA_CONCLUIDA = "tarefa_concluida", "Tarefa concluída"
    TAREFA_BLOQUEADA = "tarefa_bloqueada", "Tarefa bloqueada"
    RISCO_CONFIRMADO = "risco_confirmado", "Risco confirmado"
    INSPECAO_DEVOLVIDA = "inspecao_devolvida", "Inspeção devolvida"
    INSPECAO_PARA_REVISAO = "inspecao_para_revisao", "Inspeção para revisão"
    ALERTA_NOVO = "alerta_novo", "Alerta ambiental novo"


class Notificacao(ModeloBase):
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notificacoes"
    )
    tipo = models.CharField(max_length=30, choices=TipoNotificacao.choices)
    titulo = models.CharField(max_length=200)
    texto = models.TextField(blank=True)
    link = models.CharField(max_length=300, blank=True, help_text="Caminho interno da tela.")
    lida_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-criado_em", "-id"]
        verbose_name_plural = "notificações"
        indexes = [models.Index(fields=["usuario", "lida_em", "-criado_em"])]
