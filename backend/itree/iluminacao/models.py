"""Modelos da iluminação pública: cada importação (``LoteIluminacao``) e os pontos de serviço
(``PontoIluminacao``), com a proveniência da fonte oficial (SEINF, Prefeitura de Fortaleza)."""

from django.contrib.gis.db import models

from itree.core.models import ModeloBase


class LoteIluminacao(ModeloBase):
    """Uma importação dos pontos de iluminação pública, com fonte, licença e data (RN-PROV-003).

    Cada execução do comando grava um lote e troca todos os pontos pelos do arquivo. Os lotes
    anteriores ficam como registro das execuções; só o último tem pontos.
    """

    fonte = models.CharField(max_length=250)
    fonte_url = models.URLField(max_length=500, blank=True)
    licenca = models.CharField(max_length=300, blank=True)
    data_referencia = models.DateField(
        null=True, blank=True, help_text="Data do dado na fonte (última atualização do conjunto)."
    )
    ingerido_em = models.DateTimeField(help_text="Quando o dado foi ingerido no sistema.")
    arquivo_sha256 = models.CharField(max_length=64, blank=True)
    linhas_lidas = models.PositiveIntegerField(default=0, help_text="Linhas (uma por lâmpada).")
    pontos_importados = models.PositiveIntegerField(default=0)
    sem_coordenada = models.PositiveIntegerField(
        default=0, help_text="Pontos descartados por não terem coordenada."
    )
    coordenada_invalida = models.PositiveIntegerField(
        default=0, help_text="Pontos descartados por coordenada ilegível ou fora da faixa do SRC."
    )
    fora_do_municipio = models.PositiveIntegerField(
        default=0, help_text="Pontos descartados por caírem fora do município."
    )
    sem_codigo = models.PositiveIntegerField(
        default=0, help_text="Linhas descartadas por não terem código de ponto."
    )
    metadados = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-ingerido_em"]

    def __str__(self) -> str:
        return f"Iluminação pública, {self.ingerido_em:%d/%m/%Y}"


class PontoIluminacao(ModeloBase):
    """Ponto de serviço da iluminação pública (SEINF), com seus poste e lâmpadas.

    É camada de contexto: não altera o inventário de árvores. A fonte tem uma linha por
    lâmpada; aqui elas viram atributos do ponto (``lampadas``). A geometria fica em WGS 84; a
    fonte entrega SIRGAS 2000 / UTM 24S (EPSG:31984). Os textos de regional, bairro e
    logradouro são os da fonte; ``bairro`` é o bairro oficial resolvido pela geometria.
    """

    codigo = models.CharField(max_length=30, unique=True, help_text="Código do ponto de serviço.")
    geom = models.PointField(srid=4326)
    regional = models.CharField(max_length=60, blank=True, help_text="Regional, como na fonte.")
    bairro_fonte = models.CharField(max_length=120, blank=True, help_text="Bairro, como na fonte.")
    bairro = models.ForeignKey(
        "territorio.Territorio",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        help_text="Bairro oficial que contém o ponto (pela geometria).",
    )
    logradouro = models.CharField(max_length=200, blank=True)
    poste_tipo = models.CharField(
        max_length=100,
        blank=True,
        help_text='Tipo do poste sem a faixa de altura: "CONCRETO DUPLO T".',
    )
    altura_poste_min_m = models.FloatField(null=True, blank=True)
    altura_poste_max_m = models.FloatField(null=True, blank=True)
    lampadas = models.JSONField(
        default=list,
        blank=True,
        help_text="[{tipo, potencia_nominal_w, potencia_consumida_w, familia}], uma por lâmpada.",
    )
    lote = models.ForeignKey(LoteIluminacao, on_delete=models.CASCADE, related_name="pontos")

    class Meta:
        ordering = ["codigo"]

    def __str__(self) -> str:
        return f"Ponto {self.codigo}"
