"""Evidências: fotografias e documentos guardados no armazenamento privado.

O arquivo vai do navegador direto para o bucket (URL pré-assinada); a API
guarda os metadados e o vínculo (árvore, ocorrência e, na F2, inspeção).
"""

import pghistory
from django.conf import settings
from django.db import models

from itree.core.auditoria import eventos
from itree.core.models import ModeloBase

TIPOS_PERMITIDOS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "application/pdf": "pdf",
}
TAMANHO_MAXIMO = 25 * 1024 * 1024


class EstadoEvidencia(models.TextChoices):
    AGUARDANDO_ENVIO = "aguardando_envio", "Aguardando envio"
    DISPONIVEL = "disponivel", "Disponível"
    REMOVIDA = "removida", "Removida"


@pghistory.track(*eventos())
class Evidencia(ModeloBase):
    chave = models.CharField(max_length=300, unique=True, editable=False)
    nome_original = models.CharField(max_length=255)
    tipo_conteudo = models.CharField(max_length=100)
    tamanho = models.PositiveIntegerField()
    descricao = models.CharField(max_length=500, blank=True)
    capturada_em = models.DateTimeField(
        null=True, blank=True, help_text="Momento da captura, quando conhecido."
    )
    estado = models.CharField(
        max_length=20, choices=EstadoEvidencia.choices, default=EstadoEvidencia.AGUARDANDO_ENVIO
    )
    enviada_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    arvore = models.ForeignKey(
        "inventario.Arvore",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="evidencias",
    )
    ocorrencia = models.ForeignKey(
        "ocorrencias.Ocorrencia",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="evidencias",
    )

    inspecao = models.ForeignKey(
        "inspecoes.Inspecao",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="evidencias",
    )

    class Meta:
        ordering = ["-criado_em"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(arvore__isnull=False)
                | models.Q(ocorrencia__isnull=False)
                | models.Q(inspecao__isnull=False),
                name="evidencia_vinculada",
            )
        ]

    @property
    def eh_imagem(self) -> bool:
        return self.tipo_conteudo.startswith("image/")
