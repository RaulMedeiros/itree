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
    email_enviado_em = models.DateTimeField(
        null=True, blank=True, help_text="Quando o e-mail desta notificação foi enviado (M-14)."
    )

    class Meta:
        ordering = ["-criado_em", "-id"]
        verbose_name_plural = "notificações"
        indexes = [models.Index(fields=["usuario", "lida_em", "-criado_em"])]


class PreferenciaNotificacao(ModeloBase):
    """Escolha do usuário por tipo de notificação (M-14).

    Sem registro vale o padrão: recebe no sino e não recebe por e-mail.
    """

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="preferencias_notificacao"
    )
    tipo = models.CharField(max_length=30, choices=TipoNotificacao.choices)
    ativa = models.BooleanField(default=True, help_text="Recebe este tipo no sino.")
    email = models.BooleanField(default=False, help_text="Recebe também por e-mail.")

    class Meta:
        verbose_name_plural = "preferências de notificação"
        constraints = [
            models.UniqueConstraint(
                fields=["usuario", "tipo"], name="preferencia_notificacao_unica"
            )
        ]


class AjustesNotificacao(ModeloBase):
    """Ajustes gerais de quem recebe notificações, além da escolha por tipo (M-27).

    - ``territorios``: só notifica o que acontece nesses bairros (dentro do escopo da pessoa).
      Vazio = todo o escopo.
    - ``silenciada_ate``: até essa data (inclusive) nenhuma notificação nova é criada, nem no
      sino nem por e-mail (férias, licença). As que já chegaram ficam.
    """

    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ajustes_notificacao"
    )
    territorios = models.ManyToManyField("territorio.Territorio", blank=True, related_name="+")
    silenciada_ate = models.DateField(null=True, blank=True)

    class Meta:
        verbose_name_plural = "ajustes de notificação"


# Texto de um grupo (mesmo tipo, mesmo dia) e tela que abre a lista inteira. O singular vale
# para um só evento no grupo com o título gravado; o plural para dois ou mais.
GRUPOS: dict[str, tuple[str, str, str]] = {
    TipoNotificacao.TAREFA_ATRIBUIDA: (
        "tarefa atribuída",
        "tarefas atribuídas",
        "/equipes-tarefas?responsavel=eu",
    ),
    TipoNotificacao.TAREFA_CONCLUIDA: (
        "tarefa concluída",
        "tarefas concluídas",
        "/equipes-tarefas",
    ),
    TipoNotificacao.TAREFA_BLOQUEADA: (
        "tarefa bloqueada",
        "tarefas bloqueadas",
        "/equipes-tarefas",
    ),
    TipoNotificacao.RISCO_CONFIRMADO: (
        "risco confirmado",
        "riscos confirmados",
        "/ocorrencias",
    ),
    TipoNotificacao.INSPECAO_DEVOLVIDA: (
        "inspeção devolvida para correção",
        "inspeções devolvidas para correção",
        "/inspecoes?estado=devolvida",
    ),
    TipoNotificacao.INSPECAO_PARA_REVISAO: (
        "inspeção aguardando revisão",
        "inspeções aguardando revisão",
        "/inspecoes",
    ),
    TipoNotificacao.ALERTA_NOVO: (
        "aviso de alerta ambiental novo",
        "avisos de alertas ambientais novos",
        "/alertas",
    ),
}
