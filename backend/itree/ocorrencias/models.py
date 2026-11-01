"""Ocorrências (W-04): condição aparente, prioridade operacional e risco
confirmado são campos distintos, com autor e data próprios."""

import pghistory
from django.conf import settings
from django.contrib.gis.db import models

from itree.core.auditoria import eventos
from itree.core.geo import bairro_do_ponto
from itree.core.models import ModeloBase
from itree.core.sequencias import proximo_numero


@pghistory.track(*eventos())
class TipoOcorrencia(ModeloBase):
    """Catálogo configurável (W-10; DP-17 define a lista oficial)."""

    nome = models.CharField(max_length=100, unique=True)
    descricao = models.TextField(blank=True)
    prazo_padrao_dias = models.PositiveIntegerField(null=True, blank=True)
    ativo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nome"]

    def __str__(self) -> str:
        return self.nome


class EstadoOcorrencia(models.TextChoices):
    ABERTA = "aberta", "Aberta"
    EM_TRIAGEM = "em_triagem", "Em triagem"
    ENCAMINHADA = "encaminhada", "Encaminhada"
    EM_ATENDIMENTO = "em_atendimento", "Em atendimento"
    CONCLUIDA = "concluida", "Concluída"
    CANCELADA = "cancelada", "Cancelada"


ESTADOS_FINAIS = {EstadoOcorrencia.CONCLUIDA, EstadoOcorrencia.CANCELADA}

# Fluxo proposto em RF-OCO-004. Cancelar é possível de qualquer estado não final.
TRANSICOES: dict[str, set[str]] = {
    EstadoOcorrencia.ABERTA: {EstadoOcorrencia.EM_TRIAGEM},
    EstadoOcorrencia.EM_TRIAGEM: {EstadoOcorrencia.ENCAMINHADA, EstadoOcorrencia.EM_ATENDIMENTO},
    EstadoOcorrencia.ENCAMINHADA: {EstadoOcorrencia.EM_ATENDIMENTO, EstadoOcorrencia.EM_TRIAGEM},
    EstadoOcorrencia.EM_ATENDIMENTO: {EstadoOcorrencia.CONCLUIDA, EstadoOcorrencia.ENCAMINHADA},
    EstadoOcorrencia.CONCLUIDA: set(),
    EstadoOcorrencia.CANCELADA: set(),
}


class Prioridade(models.TextChoices):
    BAIXA = "baixa", "Baixa"
    MEDIA = "media", "Média"
    ALTA = "alta", "Alta"
    URGENTE = "urgente", "Urgente"


class OrigemOcorrencia(models.TextChoices):
    WEB = "web", "Painel web"
    APP = "app", "Aplicativo"
    IMPORTACAO = "importacao", "Importação"
    ALERTA = "alerta", "Conversão de alerta ambiental"


@pghistory.track(*eventos())
class Ocorrencia(ModeloBase):
    numero = models.BigIntegerField(unique=True, editable=False)
    tipo = models.ForeignKey(TipoOcorrencia, on_delete=models.PROTECT)
    arvore = models.ForeignKey(
        "inventario.Arvore",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="ocorrencias",
    )
    geom = models.PointField(srid=4326)
    bairro = models.ForeignKey(
        "territorio.Territorio", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    endereco = models.CharField(max_length=300, blank=True)
    descricao = models.TextField()

    # O que foi observado (não é diagnóstico).
    condicao_aparente = models.TextField(blank=True)

    # Ordem de atendimento definida pela gestão.
    prioridade = models.CharField(max_length=10, choices=Prioridade.choices, blank=True)
    prioridade_definida_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    prioridade_definida_em = models.DateTimeField(null=True, blank=True)

    # Conclusão de avaliação técnica competente.
    risco_confirmado = models.BooleanField(default=False)
    risco_descricao = models.TextField(blank=True)
    risco_responsavel = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    risco_registrado_em = models.DateTimeField(null=True, blank=True)

    estado = models.CharField(
        max_length=20, choices=EstadoOcorrencia.choices, default=EstadoOcorrencia.ABERTA
    )
    responsavel = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    equipe = models.ForeignKey(
        "contas.Equipe", null=True, blank=True, on_delete=models.PROTECT, related_name="ocorrencias"
    )
    prazo = models.DateField(null=True, blank=True)

    origem = models.CharField(max_length=20, choices=OrigemOcorrencia.choices)
    origem_referencia = models.CharField(max_length=200, blank=True)
    registrada_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    concluida_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-numero"]
        indexes = [models.Index(fields=["estado"]), models.Index(fields=["prioridade"])]

    @property
    def codigo(self) -> str:
        return f"OCO-{self.numero:06d}" if self.numero else "OCO-?"

    def save(self, *args, **kwargs):
        campos = kwargs.get("update_fields")
        if not self.numero:
            self.numero = proximo_numero("ocorrencias_ocorrencia_numero_seq")
        if campos is None or "geom" in campos:
            self.bairro = bairro_do_ponto(self.geom)
            if campos is not None:
                kwargs["update_fields"] = {*campos, "bairro"}
        super().save(*args, **kwargs)
