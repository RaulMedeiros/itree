"""Conectores de fontes externas (RF-INT-006).

Um conector sabe **onde** buscar (GeoJSON, WFS, ArcGIS REST ou CKAN), **o que** fazer com o
que chega (camada de referência no mapa ou lote de importação em prévia) e **de quanto em quanto
tempo**. É capacidade genérica: nenhum sistema municipal é escolhido aqui (DP-12), e o que vira
inventário continua dependendo de confirmação humana (DP-18).
"""

from datetime import timedelta

import pghistory
from django.conf import settings
from django.contrib.gis.db import models

from itree.core.auditoria import eventos
from itree.core.models import ModeloBase
from itree.inventario.models import LoteImportacao, ModoImportacao


class TipoConector(models.TextChoices):
    GEOJSON_URL = "geojson_url", "GeoJSON por endereço"
    WFS = "wfs", "WFS (GetFeature em GeoJSON)"
    ARCGIS_REST = "arcgis_rest", "ArcGIS REST (FeatureServer/MapServer)"
    CKAN = "ckan", "Portal CKAN (recurso GeoJSON ou CSV)"


class DestinoConector(models.TextChoices):
    CAMADA_REFERENCIA = "camada_referencia", "Camada de referência no mapa"
    LOTE_IMPORTACAO = "lote_importacao", "Lote de importação (prévia)"


class Periodicidade(models.TextChoices):
    MANUAL = "manual", "Manual"
    DIARIA = "diaria", "Diária"
    SEMANAL = "semanal", "Semanal"
    MENSAL = "mensal", "Mensal"


INTERVALO_PERIODICIDADE = {
    Periodicidade.DIARIA: timedelta(days=1),
    Periodicidade.SEMANAL: timedelta(days=7),
    Periodicidade.MENSAL: timedelta(days=30),
}


@pghistory.track(*eventos())
class Conector(ModeloBase):
    nome = models.CharField(max_length=150, unique=True)
    tipo = models.CharField(max_length=20, choices=TipoConector.choices)
    url = models.URLField(
        max_length=500,
        help_text="Endereço HTTPS da fonte; o host precisa estar na lista de fontes permitidas.",
    )
    parametros = models.JSONField(
        default=dict,
        blank=True,
        help_text="Por tipo: camada (WFS), where e tamanho_pagina (ArcGIS), pacote e recurso "
        "(CKAN), campo_id (propriedade com o identificador estável), colunas de latitude e "
        "longitude (CSV do CKAN).",
    )
    destino = models.CharField(max_length=20, choices=DestinoConector.choices)
    modelo_importacao = models.ForeignKey(
        "inventario.ModeloImportacao",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
        help_text="Só no destino lote: o mapeamento de colunas usado na prévia.",
    )
    modo = models.CharField(
        max_length=10, choices=ModoImportacao.choices, default=ModoImportacao.CRIAR
    )
    periodicidade = models.CharField(
        max_length=10, choices=Periodicidade.choices, default=Periodicidade.MANUAL
    )
    ativo = models.BooleanField(default=False)
    orgao = models.CharField(max_length=200, help_text="Órgão responsável pela fonte.")
    licenca = models.CharField(max_length=300, help_text="Licença ou termos de uso da fonte.")
    url_origem = models.URLField(max_length=500, help_text="Página da fonte, para citação.")
    cor = models.CharField(
        max_length=7, default="#b45f06", help_text="Cor da camada no mapa (#rrggbb)."
    )
    rotulos = models.JSONField(
        default=dict,
        blank=True,
        help_text="{propriedade: rótulo legível} para o popup do mapa.",
    )
    criado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["nome"]

    def __str__(self) -> str:
        return self.nome

    @property
    def intervalo(self) -> timedelta | None:
        return INTERVALO_PERIODICIDADE.get(self.periodicidade)


class OrigemExecucao(models.TextChoices):
    MANUAL = "manual", "Manual"
    AGENDADA = "agendada", "Agendada"


class ExecucaoConector(models.Model):
    """Registro de cada sincronização (RF-INT-006)."""

    conector = models.ForeignKey(Conector, on_delete=models.CASCADE, related_name="execucoes")
    origem = models.CharField(
        max_length=10, choices=OrigemExecucao.choices, default=OrigemExecucao.MANUAL
    )
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    iniciada_em = models.DateTimeField(auto_now_add=True)
    concluida_em = models.DateTimeField(null=True, blank=True)
    sucesso = models.BooleanField(default=False)
    recebidos = models.PositiveIntegerField(default=0)
    novos = models.PositiveIntegerField(default=0)
    atualizados = models.PositiveIntegerField(default=0)
    removidos = models.PositiveIntegerField(default=0)
    invalidos = models.PositiveIntegerField(default=0)
    erro = models.TextField(blank=True)
    detalhe = models.TextField(blank=True, help_text="Observação que não é erro.")
    lote = models.ForeignKey(
        LoteImportacao,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        help_text="Prévia criada por esta execução (destino lote).",
    )

    class Meta:
        ordering = ["-iniciada_em", "-id"]
        indexes = [models.Index(fields=["conector", "-iniciada_em"])]


class FeicaoReferencia(ModeloBase):
    """Feição de uma camada de referência. É contexto: não é inventário nem cria árvores."""

    conector = models.ForeignKey(Conector, on_delete=models.CASCADE, related_name="feicoes")
    id_externo = models.CharField(max_length=200)
    geom = models.GeometryField(srid=4326)
    propriedades = models.JSONField(default=dict)

    class Meta:
        ordering = ["conector", "id_externo"]
        constraints = [
            models.UniqueConstraint(
                fields=["conector", "id_externo"], name="feicao_referencia_unica"
            )
        ]
