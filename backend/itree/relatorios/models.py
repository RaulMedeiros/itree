import pghistory
from django.conf import settings
from django.db import models

from itree.core.auditoria import eventos
from itree.core.models import ModeloBase


@pghistory.track(*eventos())
class Exportacao(ModeloBase):
    """Toda exportação fica registrada (RF-REL-004)."""

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    conjunto = models.CharField(max_length=40)
    formato = models.CharField(max_length=10)
    filtros = models.JSONField(default=dict)
    linhas = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-criado_em"]
