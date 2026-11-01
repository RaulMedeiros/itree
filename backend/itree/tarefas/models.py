"""Tarefas de campo (W-07): quem faz o quê, onde e até quando."""

import pghistory
from django.conf import settings
from django.contrib.gis.db import models

from itree.core.auditoria import eventos
from itree.core.models import ModeloBase
from itree.core.sequencias import proximo_numero


class TipoTarefa(models.TextChoices):
    INSPECAO_ARVORE = "inspecao_arvore", "Inspeção de árvore"
    ATENDIMENTO_OCORRENCIA = "atendimento_ocorrencia", "Atendimento de ocorrência"


class EstadoTarefa(models.TextChoices):
    NAO_INICIADA = "nao_iniciada", "Não iniciada"
    EM_EXECUCAO = "em_execucao", "Em execução"
    CONCLUIDA = "concluida", "Concluída"
    BLOQUEADA = "bloqueada", "Bloqueada"
    CANCELADA = "cancelada", "Cancelada"


ESTADOS_FINAIS_TAREFA = {EstadoTarefa.CONCLUIDA, EstadoTarefa.CANCELADA}
EXIGEM_MOTIVO = {EstadoTarefa.BLOQUEADA, EstadoTarefa.CANCELADA}

TRANSICOES_TAREFA: dict[str, set[str]] = {
    EstadoTarefa.NAO_INICIADA: {
        EstadoTarefa.EM_EXECUCAO,
        EstadoTarefa.BLOQUEADA,
        EstadoTarefa.CANCELADA,
    },
    EstadoTarefa.EM_EXECUCAO: {
        EstadoTarefa.CONCLUIDA,
        EstadoTarefa.BLOQUEADA,
        EstadoTarefa.CANCELADA,
    },
    EstadoTarefa.BLOQUEADA: {
        EstadoTarefa.NAO_INICIADA,
        EstadoTarefa.EM_EXECUCAO,
        EstadoTarefa.CANCELADA,
    },
    EstadoTarefa.CONCLUIDA: set(),
    EstadoTarefa.CANCELADA: set(),
}


@pghistory.track(*eventos())
class Tarefa(ModeloBase):
    numero = models.BigIntegerField(unique=True, editable=False)
    tipo = models.CharField(max_length=30, choices=TipoTarefa.choices)
    arvore = models.ForeignKey(
        "inventario.Arvore", null=True, blank=True, on_delete=models.PROTECT, related_name="tarefas"
    )
    ocorrencia = models.ForeignKey(
        "ocorrencias.Ocorrencia",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="tarefas",
    )
    geom = models.PointField(srid=4326, help_text="Local da tarefa (copiado do alvo).")
    descricao = models.TextField(blank=True)
    responsavel = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="tarefas",
    )
    equipe = models.ForeignKey(
        "contas.Equipe", null=True, blank=True, on_delete=models.PROTECT, related_name="tarefas"
    )
    prazo = models.DateField(null=True, blank=True)
    prioridade = models.CharField(max_length=10, blank=True)
    estado = models.CharField(
        max_length=20, choices=EstadoTarefa.choices, default=EstadoTarefa.NAO_INICIADA
    )
    motivo_estado = models.TextField(blank=True)
    criada_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    concluida_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["prazo", "-numero"]
        indexes = [models.Index(fields=["estado"]), models.Index(fields=["prazo"])]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(arvore__isnull=False) | models.Q(ocorrencia__isnull=False),
                name="tarefa_com_alvo",
            )
        ]

    @property
    def codigo(self) -> str:
        return f"TAR-{self.numero:06d}" if self.numero else "TAR-?"

    def save(self, *args, **kwargs):
        if not self.numero:
            self.numero = proximo_numero("tarefas_tarefa_numero_seq")
        super().save(*args, **kwargs)
