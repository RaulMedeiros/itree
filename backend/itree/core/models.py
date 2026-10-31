from django.db import models

from .ids import uuid7


class ModeloBase(models.Model):
    """Base de todas as entidades de domínio: ID UUIDv7 e carimbos de tempo."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
