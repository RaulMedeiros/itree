import pghistory
from django.contrib.gis.db import models
from django.db.models import Q

from itree.core.models import ModeloBase


class TipoAreaVerde(models.TextChoices):
    PRACA = "praca", "Praça"
    PARQUE = "parque", "Parque urbano"
    UNIDADE_CONSERVACAO = "unidade_conservacao", "Unidade de conservação"


class SubtipoAreaVerde(models.TextChoices):
    """Subtipo das praças, derivado do nome (ver ``subtipos.subtipo_da_praca``)."""

    PRACA = "praca", "Praça"
    ARENINHA = "areninha", "Areninha"
    CALCADAO = "calcadao", "Calçadão"
    ROTATORIA = "rotatoria", "Rotatória"
    SEM_DENOMINACAO = "sem_denominacao", "Sem denominação oficial"


@pghistory.track(pghistory.InsertEvent(), pghistory.UpdateEvent(), pghistory.DeleteEvent())
class AreaVerde(ModeloBase):
    """Praça, parque urbano ou unidade de conservação, com fonte e data (RN-PROV-003).

    É camada de contexto: não altera nem substitui o inventário de árvores. A
    geometria fica em WGS 84 (EPSG:4326); o SRC original informado pela fonte
    fica em ``metadados['src_original']`` (RF-INT-003).
    """

    tipo = models.CharField(max_length=30, choices=TipoAreaVerde.choices)
    subtipo = models.CharField(
        max_length=30,
        choices=SubtipoAreaVerde.choices,
        blank=True,
        help_text="Só nas praças: praça, areninha, calçadão, rotatória ou sem denominação.",
    )
    nome = models.CharField(max_length=250)
    nome_popular = models.CharField(max_length=250, blank=True)
    codigo_externo = models.CharField(
        max_length=50,
        blank=True,
        help_text="Identificador do registro na fonte; vazio quando a fonte não traz.",
    )
    orgao_gestor = models.CharField(
        max_length=200, blank=True, help_text="Órgão que a fonte indica como responsável."
    )
    esfera = models.CharField(max_length=30, blank=True)
    codigo_cnuc = models.CharField(
        max_length=20,
        blank=True,
        help_text=(
            "Código da unidade no Cadastro Nacional de UCs (MMA), gravado por "
            "``conferir_ucs_cnuc``. Feições da mesma UC repetem o código."
        ),
    )
    esfera_cnuc = models.CharField(
        max_length=30,
        blank=True,
        help_text="Esfera administrativa (federal, estadual, municipal) segundo o CNUC.",
    )
    cnuc_conferido_em = models.DateTimeField(
        null=True, blank=True, help_text="Quando a conferência com o CNUC casou esta área."
    )
    ato_legal = models.CharField(max_length=300, blank=True)
    area_m2 = models.FloatField(null=True, blank=True, help_text="Área informada pela fonte.")
    geom = models.MultiPolygonField(srid=4326)

    fonte = models.CharField(max_length=250)
    fonte_url = models.URLField(max_length=500, blank=True)
    licenca = models.CharField(max_length=300, blank=True)
    data_referencia = models.DateField(
        null=True, blank=True, help_text="Data do dado na fonte, quando informada."
    )
    ingerido_em = models.DateTimeField(help_text="Quando o dado foi ingerido no sistema.")
    metadados = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["tipo", "nome"]
        constraints = [
            models.UniqueConstraint(
                fields=["tipo", "codigo_externo"],
                condition=~Q(codigo_externo=""),
                name="area_verde_tipo_codigo_unico",
            )
        ]

    def __str__(self) -> str:
        return f"{self.get_tipo_display()} {self.nome}"
