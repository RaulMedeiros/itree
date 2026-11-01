"""Inspeções (W-05). Executadas no aplicativo de campo; revisadas e validadas no web.

Estado do processo (negócio) e estado de sincronização (transmissão) são
dimensões diferentes: aqui o servidor guarda o processo e o que já recebeu do
dispositivo (versão e momento de recebimento).
"""

import pghistory
from django.conf import settings
from django.contrib.gis.db import models
from django.contrib.postgres.fields import ArrayField

from itree.core.auditoria import eventos
from itree.core.ids import uuid7
from itree.core.sequencias import proximo_numero


class EstadoInspecao(models.TextChoices):
    RASCUNHO = "rascunho", "Rascunho"
    EM_REVISAO = "em_revisao", "Em revisão"
    DEVOLVIDA = "devolvida", "Devolvida para correção"
    VALIDADA = "validada", "Validada"


class CondicaoAparente(models.TextChoices):
    """Escala **provisória** até o protocolo técnico (DP-03)."""

    BOA = "boa", "Boa"
    REGULAR = "regular", "Regular"
    RUIM = "ruim", "Ruim"
    MORTA = "morta", "Aparentemente morta"
    NAO_AVALIADA = "nao_avaliada", "Não avaliada"


class SinalObservado(models.TextChoices):
    FOLHAGEM_ESCASSA = "folhagem_escassa", "Folhagem escassa"
    DESCOLORACAO = "descoloracao", "Descoloração da folhagem"
    FERIDA = "ferida", "Ferida ou dano visível no tronco"
    FUNGOS = "fungos", "Presença aparente de fungos"
    CAVIDADE = "cavidade", "Cavidade ou oco aparente"
    INCLINACAO = "inclinacao", "Inclinação perceptível"
    GALHOS_SECOS = "galhos_secos", "Galhos secos"
    GALHOS_QUEBRADOS = "galhos_quebrados", "Galhos quebrados ou pendurados"
    RAIZ_EXPOSTA = "raiz_exposta", "Raízes expostas ou danificadas"
    CONFLITO_REDE = "conflito_rede", "Conflito com rede aérea"
    CONFLITO_CALCADA = "conflito_calcada", "Conflito com calçada ou edificação"
    PRAGAS = "pragas", "Presença aparente de pragas"


class OrigemInspecao(models.TextChoices):
    APP = "app", "Aplicativo de campo"
    WEB = "web", "Painel web (contingência)"


@pghistory.track(*eventos())
class Inspecao(models.Model):
    # O ID é gerado no dispositivo (UUIDv7), permitindo criação offline e
    # reenvio idempotente (especificação consolidada §5).
    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    numero = models.BigIntegerField(unique=True, editable=False)
    arvore = models.ForeignKey(
        "inventario.Arvore", on_delete=models.PROTECT, related_name="inspecoes"
    )
    tarefa = models.ForeignKey(
        "tarefas.Tarefa", null=True, blank=True, on_delete=models.SET_NULL, related_name="inspecoes"
    )
    tecnico = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    realizada_em = models.DateTimeField(help_text="Momento da inspeção no dispositivo.")

    geom = models.PointField(
        srid=4326, null=True, blank=True, help_text="GPS no momento da inspeção."
    )
    precisao_m = models.FloatField(null=True, blank=True)
    arvore_confirmada = models.BooleanField(
        default=True, help_text="O técnico confirmou que o registro corresponde à árvore observada."
    )

    especie = models.ForeignKey(
        "inventario.Especie", null=True, blank=True, on_delete=models.PROTECT
    )
    especie_texto = models.CharField(max_length=200, blank=True)
    condicao_aparente = models.CharField(
        max_length=20, choices=CondicaoAparente.choices, default=CondicaoAparente.NAO_AVALIADA
    )
    sinais = ArrayField(
        models.CharField(max_length=30, choices=SinalObservado.choices), default=list, blank=True
    )
    observacoes = models.TextField(blank=True)
    requer_encaminhamento = models.BooleanField(default=False)

    estado = models.CharField(
        max_length=20, choices=EstadoInspecao.choices, default=EstadoInspecao.RASCUNHO
    )
    motivo_devolucao = models.TextField(blank=True)
    revisor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    validada_em = models.DateTimeField(null=True, blank=True)
    aplicado_ao_cadastro = ArrayField(
        models.CharField(max_length=30),
        default=list,
        blank=True,
        help_text="Valores que o revisor escolheu aplicar ao cadastro da árvore.",
    )

    origem = models.CharField(
        max_length=10, choices=OrigemInspecao.choices, default=OrigemInspecao.APP
    )
    dispositivo = models.CharField(max_length=100, blank=True)
    versao = models.PositiveIntegerField(
        default=1, help_text="Controle de concorrência na sincronização."
    )
    recebida_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-realizada_em"]
        indexes = [models.Index(fields=["estado"]), models.Index(fields=["realizada_em"])]

    @property
    def codigo(self) -> str:
        return f"INS-{self.numero:06d}" if self.numero else "INS-?"

    def save(self, *args, **kwargs):
        if not self.numero:
            self.numero = proximo_numero("inspecoes_inspecao_numero_seq")
        super().save(*args, **kwargs)
