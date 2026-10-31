import pghistory
from django.contrib.gis.db import models

from itree.core.models import ModeloBase


class TipoTerritorio(models.TextChoices):
    MUNICIPIO = "municipio", "Município"
    REGIONAL = "regional", "Regional"
    BAIRRO = "bairro", "Bairro"


@pghistory.track(pghistory.InsertEvent(), pghistory.UpdateEvent(), pghistory.DeleteEvent())
class Territorio(ModeloBase):
    """Limite administrativo com fonte e data (T-02, RN-PROV-003).

    A geometria é armazenada em WGS 84 (EPSG:4326); o SRC original dos dados
    importados fica em ``metadados['src_original']`` (ADR-0001 §2.3).
    """

    nome = models.CharField(max_length=200)
    tipo = models.CharField(max_length=20, choices=TipoTerritorio.choices)
    codigo = models.CharField(max_length=50, help_text="Código do território na fonte de origem.")
    pai = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="filhos"
    )
    geom = models.MultiPolygonField(srid=4326)

    fonte = models.CharField(max_length=200)
    fonte_url = models.URLField(max_length=500, blank=True)
    licenca = models.CharField(max_length=200, blank=True)
    data_referencia = models.DateField(
        null=True, blank=True, help_text="Data do dado na fonte, quando informada."
    )
    ingerido_em = models.DateTimeField(help_text="Quando o dado foi ingerido no sistema.")
    metadados = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["tipo", "nome"]
        constraints = [
            models.UniqueConstraint(fields=["tipo", "codigo"], name="territorio_tipo_codigo_unico")
        ]

    def __str__(self) -> str:
        return f"{self.get_tipo_display()} {self.nome}"
