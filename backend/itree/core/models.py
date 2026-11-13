from django.db import models

from .ids import uuid7


class ModeloBase(models.Model):
    """Base de todas as entidades de domínio: ID UUIDv7 e carimbos de tempo."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class EstadoOperacao(models.TextChoices):
    PENDENTE = "pendente", "Na fila"
    EM_ANDAMENTO = "em_andamento", "Em andamento"
    CONCLUIDA = "concluida", "Concluída"
    FALHOU = "falhou", "Interrompida por erro"


ESTADOS_FINAIS_OPERACAO = {EstadoOperacao.CONCLUIDA, EstadoOperacao.FALHOU}


class OperacaoEmLote(ModeloBase):
    """Ação em lote grande, executada em segundo plano (M-26).

    Guarda o que a pessoa pediu (`recurso`, `acao`, os ids já resolvidos e os parâmetros) e o
    andamento: quantos registros foram vistos, quantos mudaram e, dos que não mudaram, o motivo.
    A tela acompanha o estado por polling; o resultado fica disponível depois de concluída.
    """

    usuario = models.ForeignKey(
        "contas.Usuario", on_delete=models.PROTECT, related_name="operacoes_em_lote"
    )
    recurso = models.CharField(max_length=30, help_text="ocorrencias, tarefas ou alertas.")
    acao = models.CharField(max_length=30)
    estado = models.CharField(
        max_length=20, choices=EstadoOperacao.choices, default=EstadoOperacao.PENDENTE
    )
    total = models.PositiveIntegerField(default=0)
    processados = models.PositiveIntegerField(default=0)
    atualizadas = models.PositiveIntegerField(default=0)
    falhas = models.PositiveIntegerField(
        default=0, help_text="Registros que não foram alterados (encerrados, fora do escopo, erro)."
    )
    motivos = models.JSONField(
        default=list,
        blank=True,
        help_text="[{id, codigo, motivo}] dos registros não alterados; guarda até "
        "`LIMITE_MOTIVOS_GUARDADOS`, o resto só entra na contagem de `falhas`.",
    )
    erro = models.TextField(blank=True)
    parametros = models.JSONField(
        default=dict, blank=True, help_text="ids resolvidos, motivo e parâmetros da ação."
    )
    iniciada_em = models.DateTimeField(null=True, blank=True)
    concluida_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-criado_em"]

    def __str__(self) -> str:
        return f"{self.recurso}/{self.acao} ({self.get_estado_display()})"
