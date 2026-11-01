"""Alertas ambientais (W-08). Sinais de fontes externas para **triagem humana**.

Regra crítica: detecção por satélite, foco de calor ou ausência de licença
encontrada numa base não prova, por si só, ilegalidade. Nenhum status sugere
infração antes da confirmação formal pela autoridade competente.
"""

import pghistory
from django.conf import settings
from django.contrib.gis.db import models

from itree.core.auditoria import eventos
from itree.core.models import ModeloBase
from itree.core.sequencias import proximo_numero


class FonteAlerta(models.TextChoices):
    INPE_FOCOS = "inpe_focos", "INPE — BDQueimadas (focos de calor)"
    INPE_DETER = "inpe_deter", "INPE — TerraBrasilis/DETER"
    MAPBIOMAS = "mapbiomas", "MapBiomas Alerta"


class TipoAlerta(models.TextChoices):
    FOCO_CALOR = "foco_calor", "Foco de calor"
    SUPRESSAO = "supressao", "Alteração/supressão de vegetação"


class StatusAlerta(models.TextChoices):
    """Vocabulário recomendado na especificação (§7.5)."""

    DETECTADO = "detectado", "Alerta detectado"
    EM_TRIAGEM = "em_triagem", "Em triagem"
    REQUER_VERIFICACAO = "requer_verificacao", "Requer verificação"
    COMPATIVEL_AUTORIZACAO = "compativel_autorizacao", "Compatível com autorização localizada"
    ENCAMINHADO = "encaminhado", "Encaminhado à fiscalização"
    CONFIRMADO = "confirmado", "Confirmado pela autoridade"
    DESCARTADO = "descartado", "Descartado"


S = StatusAlerta
FINAIS_ALERTA = {S.CONFIRMADO, S.DESCARTADO}
TRANSICOES_ALERTA: dict[str, set[str]] = {
    S.DETECTADO: {S.EM_TRIAGEM},
    S.EM_TRIAGEM: {S.REQUER_VERIFICACAO, S.COMPATIVEL_AUTORIZACAO, S.ENCAMINHADO, S.DESCARTADO},
    S.REQUER_VERIFICACAO: {S.EM_TRIAGEM, S.ENCAMINHADO, S.DESCARTADO},
    S.COMPATIVEL_AUTORIZACAO: {S.EM_TRIAGEM, S.ENCAMINHADO, S.DESCARTADO},
    S.ENCAMINHADO: {S.CONFIRMADO, S.DESCARTADO},
    S.CONFIRMADO: set(),
    S.DESCARTADO: set(),
}
EXIGEM_JUSTIFICATIVA = {S.DESCARTADO, S.CONFIRMADO, S.COMPATIVEL_AUTORIZACAO, S.ENCAMINHADO}
EXIGEM_REFERENCIA = {
    S.CONFIRMADO: "documento da autoridade",
    S.ENCAMINHADO: "protocolo de encaminhamento",
}


@pghistory.track(*eventos(), exclude=["propriedades"])
class AlertaAmbiental(ModeloBase):
    numero = models.BigIntegerField(unique=True, editable=False)
    fonte = models.CharField(max_length=20, choices=FonteAlerta.choices)
    id_externo = models.CharField(max_length=200)
    tipo = models.CharField(max_length=20, choices=TipoAlerta.choices)
    geom = models.GeometryField(srid=4326, help_text="Geometria como recebida (ponto ou polígono).")
    src_original = models.CharField(max_length=100, blank=True)
    area_ha = models.FloatField(null=True, blank=True, help_text="Área do polígono, quando houver.")
    data_deteccao = models.DateTimeField(help_text="Data informada pela fonte.")
    ingerido_em = models.DateTimeField(auto_now_add=True)
    propriedades = models.JSONField(default=dict, help_text="Atributos originais da fonte.")
    url_origem = models.URLField(max_length=500, blank=True)
    bairros = models.JSONField(
        default=list, help_text="Bairros cadastrados que a geometria intersecta."
    )

    status = models.CharField(
        max_length=30, choices=StatusAlerta.choices, default=StatusAlerta.DETECTADO
    )
    justificativa = models.TextField(blank=True)
    referencia = models.CharField(
        max_length=200,
        blank=True,
        help_text="Protocolo de encaminhamento ou documento da autoridade.",
    )
    analisado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    ocorrencia = models.OneToOneField(
        "ocorrencias.Ocorrencia",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="alerta",
    )

    class Meta:
        ordering = ["-data_deteccao"]
        constraints = [
            models.UniqueConstraint(fields=["fonte", "id_externo"], name="alerta_fonte_id_unico")
        ]
        indexes = [models.Index(fields=["status"]), models.Index(fields=["data_deteccao"])]

    @property
    def codigo(self) -> str:
        return f"ALR-{self.numero:06d}" if self.numero else "ALR-?"

    def save(self, *args, **kwargs):
        if not self.numero:
            self.numero = proximo_numero("alertas_alerta_numero_seq")
        super().save(*args, **kwargs)


class IngestaoAlertas(models.Model):
    """Registro de cada execução de ingestão (RF-INT-001)."""

    fonte = models.CharField(max_length=20, choices=FonteAlerta.choices)
    origem = models.CharField(
        max_length=500, help_text="URL consultada ou nome do arquivo enviado."
    )
    iniciada_em = models.DateTimeField(auto_now_add=True)
    concluida_em = models.DateTimeField(null=True, blank=True)
    sucesso = models.BooleanField(default=False)
    recebidos = models.PositiveIntegerField(default=0)
    novos = models.PositiveIntegerField(default=0)
    ja_existentes = models.PositiveIntegerField(default=0)
    fora_do_municipio = models.PositiveIntegerField(default=0)
    invalidos = models.PositiveIntegerField(default=0)
    erro = models.TextField(blank=True)
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )

    class Meta:
        ordering = ["-iniciada_em"]
