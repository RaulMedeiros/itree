"""Imóveis e uso do solo (camadas de contexto, só leitura): edificações, uso predominante por lote
(SEFIN, 2022) e macrozoneamento (SEUMA, 2022). Nada aqui altera o inventário de árvores."""

from django.contrib.gis.db import models

from itree.core.models import ModeloBase


class FonteEdificacao(models.TextChoices):
    OPEN_BUILDINGS = "open_buildings", "Google Open Buildings v3"
    OSM = "osm", "OpenStreetMap"


class UsoLote(models.TextChoices):
    """Uso predominante do lote (SEFIN): residencial ou não residencial quando a área edificada do
    uso chega a 70%; misto entre 31% e 69%; territorial sem área edificada."""

    RESIDENCIAL = "residencial", "Residencial"
    NAO_RESIDENCIAL = "nao_residencial", "Não residencial"
    MISTO = "misto", "Misto"
    TERRITORIAL = "territorial", "Territorial (sem edificação)"


class LoteEdificacoes(ModeloBase):
    """Uma importação das edificações, com fonte, licença e data (RN-PROV-003). Cada execução
    troca todas as edificações da mesma fonte; só a última importação tem edificações."""

    fonte = models.CharField(max_length=30, choices=FonteEdificacao.choices)
    fonte_texto = models.CharField(max_length=250)
    fonte_url = models.URLField(max_length=500, blank=True)
    licenca = models.CharField(max_length=300, blank=True)
    data_referencia = models.DateField(null=True, blank=True)
    ingerido_em = models.DateTimeField()
    arquivo_sha256 = models.CharField(max_length=64, blank=True)
    linhas_lidas = models.PositiveIntegerField(default=0)
    importadas = models.PositiveIntegerField(default=0)
    fora_do_municipio = models.PositiveIntegerField(default=0)
    invalidas = models.PositiveIntegerField(default=0)
    confianca_minima = models.FloatField(null=True, blank=True)
    duracao_s = models.FloatField(default=0)
    metadados = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-ingerido_em"]

    def __str__(self) -> str:
        return f"Edificações ({self.get_fonte_display()}), {self.ingerido_em:%d/%m/%Y}"


class Edificacao(models.Model):
    """Contorno de edificação. Identificador numérico (e não UUID) para a carga em lote de
    centenas de milhares de linhas. ``centro`` é o ponto dentro do polígono (ponto na superfície),
    usado nas distâncias e na classificação pelo lote."""

    lote = models.ForeignKey(LoteEdificacoes, on_delete=models.CASCADE, related_name="edificacoes")
    fonte = models.CharField(max_length=30, choices=FonteEdificacao.choices)
    codigo_externo = models.CharField(max_length=40, blank=True, help_text="Plus code na fonte.")
    geom = models.PolygonField(srid=4326)
    centro = models.PointField(srid=4326)
    area_m2 = models.FloatField()
    confianca = models.FloatField(
        null=True, blank=True, help_text="Confiança da fonte (0 a 1), quando informada."
    )
    bairro = models.ForeignKey(
        "territorio.Territorio", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    uso = models.CharField(
        max_length=20,
        choices=UsoLote.choices,
        blank=True,
        help_text="Uso do lote que contém o centro (SEFIN 2022). Vazio sem classificação.",
    )

    class Meta:
        ordering = ["id"]
        indexes = [models.Index(fields=["bairro", "uso"], name="edificacao_bairro_uso_idx")]

    def __str__(self) -> str:
        return f"Edificação {self.pk} ({self.area_m2:.0f} m²)"


class LoteUsoSolo(ModeloBase):
    """Lote com uso predominante (SEFIN, 2022), lido do WMS do Fortaleza em Mapas por
    ``GetFeatureInfo``. Serve só para classificar as edificações pelo lote que contém o centro."""

    camada = models.CharField(max_length=60, help_text="Camada do WMS, por regional.")
    id_fonte = models.PositiveIntegerField()
    geom = models.MultiPolygonField(srid=4326)
    uso = models.CharField(max_length=20, choices=UsoLote.choices)
    unidades = models.PositiveIntegerField(default=0)
    unidades_residenciais = models.PositiveIntegerField(default=0)
    unidades_nao_residenciais = models.PositiveIntegerField(default=0)
    area_residencial_m2 = models.FloatField(null=True, blank=True)
    area_nao_residencial_m2 = models.FloatField(null=True, blank=True)
    ingerido_em = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["camada", "id_fonte"], name="lote_uso_camada_id_unico")
        ]

    def __str__(self) -> str:
        return f"Lote {self.camada}#{self.id_fonte} ({self.uso})"


class Macrozona(ModeloBase):
    """Zona do Macrozoneamento Urbano de Fortaleza (SEUMA, 2022), com os parâmetros de ocupação que
    a fonte traz. Camada de contexto, só leitura."""

    codigo_fonte = models.PositiveIntegerField(help_text="Id da feição na fonte.")
    nome = models.CharField(max_length=200)
    sigla = models.CharField(max_length=30, blank=True, help_text="ZOP 1, ZOC, ZRU 2, ZO...")
    geom = models.MultiPolygonField(srid=4326)
    parametros = models.JSONField(
        default=dict, blank=True, help_text="Taxas e índices da zona, como na fonte."
    )
    fonte = models.CharField(max_length=250)
    fonte_url = models.URLField(max_length=500, blank=True)
    licenca = models.CharField(max_length=300, blank=True)
    data_referencia = models.DateField(null=True, blank=True)
    ingerido_em = models.DateTimeField()

    class Meta:
        ordering = ["nome"]
        constraints = [
            models.UniqueConstraint(fields=["codigo_fonte"], name="macrozona_codigo_unico")
        ]

    def __str__(self) -> str:
        return self.nome
