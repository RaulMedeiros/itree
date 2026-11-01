"""Sugestões de IA (T-04): armazenadas à parte, com modelo, versão e resultado
original, e só afetam o cadastro por decisão explícita de pessoa habilitada."""

import pghistory
from django.conf import settings
from django.db import models

from itree.core.auditoria import eventos
from itree.core.models import ModeloBase


class TarefaIA(models.TextChoices):
    ESPECIE = "especie", "Sugestão de espécie por imagem"
    SINAIS_VISUAIS = "sinais_visuais", "Apoio visual à inspeção"


class DecisaoIA(models.TextChoices):
    PENDENTE = "pendente", "Aguardando revisão"
    ACEITA = "aceita", "Aceita"
    REJEITADA = "rejeitada", "Rejeitada"


@pghistory.track(*eventos(), exclude=["resultado"])
class InferenciaIA(ModeloBase):
    tarefa = models.CharField(max_length=20, choices=TarefaIA.choices)
    arvore = models.ForeignKey(
        "inventario.Arvore", on_delete=models.CASCADE, related_name="inferencias"
    )
    inspecao = models.ForeignKey(
        "inspecoes.Inspecao",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="inferencias",
    )
    evidencias = models.ManyToManyField(
        "evidencias.Evidencia", blank=True, related_name="inferencias"
    )
    modelo = models.CharField(max_length=100)
    versao_modelo = models.CharField(max_length=50)
    resultado = models.JSONField(help_text="Resultado original do modelo, sem alterações.")
    alternativas = models.JSONField(
        default=list,
        help_text="Espécies sugeridas [{especie_id, nome}], em ordem, sem percentuais.",
    )
    qualidade_insuficiente = models.BooleanField(
        default=False, help_text="O modelo indicou imagem inadequada para concluir."
    )
    orientacao = models.TextField(blank=True, help_text="Ex.: fotografar folhas e casca.")
    decisao = models.CharField(max_length=10, choices=DecisaoIA.choices, default=DecisaoIA.PENDENTE)
    especie_escolhida = models.ForeignKey(
        "inventario.Especie", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    decidida_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    decidida_em = models.DateTimeField(null=True, blank=True)
    registrada_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )

    class Meta:
        ordering = ["-criado_em"]
