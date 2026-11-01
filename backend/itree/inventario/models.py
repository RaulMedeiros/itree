"""Inventário arbóreo (W-03): espécies, árvores, medidas e importações."""

import pghistory
from django.conf import settings
from django.contrib.gis.db import models
from django.contrib.postgres.fields import ArrayField

from itree.core.auditoria import eventos
from itree.core.geo import bairro_do_ponto
from itree.core.models import ModeloBase
from itree.core.sequencias import proximo_numero


class OrigemValor(models.TextChoices):
    """Classes de origem de um valor (T-01 §2)."""

    MEDIDO = "medido", "Medido"
    ESTIMADO = "estimado", "Estimado"
    INFERIDO = "inferido", "Inferido (IA)"
    IMPORTADO = "importado", "Importado"


class OrigemLocalizacao(models.TextChoices):
    GPS_CAMPO = "gps_campo", "GPS de campo"
    IMPORTADA = "importada", "Importada"
    ESTIMADA_WEB = "estimada_web", "Estimada (web)"
    GEOCODIFICADA = "geocodificada", "Geocodificada (endereço)"


class OrigemRegistro(models.TextChoices):
    WEB = "web", "Painel web"
    APP = "app", "Aplicativo"
    IMPORTACAO = "importacao", "Importação"


class SituacaoReferencias(models.TextChoices):
    NAO_CONSULTADA = "nao_consultada", "Ainda não consultadas"
    ENCONTRADAS = "encontradas", "Encontradas"
    NAO_ENCONTRADAS = "nao_encontradas", "Não encontradas"
    ERRO = "erro", "Erro na consulta"


@pghistory.track(*eventos())
class Especie(ModeloBase):
    """Catálogo taxonômico (DP-02 define a taxonomia oficial)."""

    nome_cientifico = models.CharField(max_length=200, unique=True)
    familia = models.CharField(max_length=100, blank=True)
    nomes_comuns = ArrayField(models.CharField(max_length=100), default=list, blank=True)
    nativa_brasil = models.BooleanField(null=True, blank=True)
    ativa = models.BooleanField(default=True)
    sucessora = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Nome aceito quando esta espécie é sinônimo ou obsoleta.",
    )
    fonte_taxonomica = models.CharField(max_length=200, blank=True)

    # Referências externas (M-01). Vêm de consulta automática ao Wikidata,
    # Wikipedia e Wikimedia Commons; são exibidas com fonte, licença e data e
    # nunca sobrescrevem os campos taxonômicos acima, mantidos pela administração.
    referencias_situacao = models.CharField(
        max_length=20,
        choices=SituacaoReferencias.choices,
        default=SituacaoReferencias.NAO_CONSULTADA,
    )
    referencias_mensagem = models.CharField(max_length=300, blank=True)
    referencias_consultadas_em = models.DateTimeField(null=True, blank=True)
    wikidata_id = models.CharField(max_length=20, blank=True)
    wikipedia_idioma = models.CharField(max_length=5, blank=True)
    wikipedia_titulo = models.CharField(max_length=300, blank=True)
    wikipedia_url = models.URLField(max_length=500, blank=True)
    wikipedia_descricao = models.CharField(max_length=300, blank=True)
    wikipedia_resumo = models.TextField(blank=True)
    gbif_id = models.BigIntegerField(null=True, blank=True)
    imagem_url = models.URLField(max_length=1000, blank=True)
    imagem_pagina_url = models.URLField(max_length=1000, blank=True)
    imagem_autor = models.CharField(max_length=300, blank=True)
    imagem_licenca = models.CharField(max_length=100, blank=True)
    imagem_licenca_url = models.URLField(max_length=500, blank=True)

    class Meta:
        ordering = ["nome_cientifico"]

    def __str__(self) -> str:
        return self.nome_cientifico

    @property
    def gbif_url(self) -> str:
        return f"https://www.gbif.org/species/{self.gbif_id}" if self.gbif_id else ""

    @property
    def wikidata_url(self) -> str:
        return f"https://www.wikidata.org/wiki/{self.wikidata_id}" if self.wikidata_id else ""


class EstadoEspecie(models.TextChoices):
    CONFIRMADA = "confirmada", "Confirmada"
    SUGERIDA_IA = "sugerida_ia", "Sugerida (IA)"
    INFORMADA = "informada", "Informada (não validada)"
    NAO_IDENTIFICADA = "nao_identificada", "Não identificada"


class SituacaoArvore(models.TextChoices):
    ATIVA = "ativa", "Ativa"
    EXCLUIDA = "excluida", "Excluída"
    FUNDIDA = "fundida", "Fundida em outro registro"


@pghistory.track(*eventos())
class Arvore(ModeloBase):
    """Cadastro individual georreferenciado (W-03, T-02)."""

    numero = models.BigIntegerField(unique=True, editable=False)

    especie = models.ForeignKey(Especie, null=True, blank=True, on_delete=models.PROTECT)
    especie_estado = models.CharField(
        max_length=20, choices=EstadoEspecie.choices, default=EstadoEspecie.NAO_IDENTIFICADA
    )
    especie_texto_original = models.CharField(
        max_length=200,
        blank=True,
        help_text="Nome como veio da fonte, quando não casou com o catálogo.",
    )

    geom = models.PointField(srid=4326, null=True, blank=True)
    localizacao_origem = models.CharField(
        max_length=20, choices=OrigemLocalizacao.choices, blank=True
    )
    precisao_m = models.FloatField(
        null=True, blank=True, help_text="Precisão horizontal informada, em metros."
    )
    endereco = models.CharField(max_length=300, blank=True)
    bairro = models.ForeignKey(
        "territorio.Territorio", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    situacao = models.CharField(
        max_length=20, choices=SituacaoArvore.choices, default=SituacaoArvore.ATIVA
    )
    fundida_em = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="fundidas"
    )
    motivo_situacao = models.TextField(blank=True)

    # Últimos valores validados vindos de inspeções (aplicados pelo revisor).
    condicao_aparente = models.CharField(max_length=20, blank=True)
    condicao_aparente_em = models.DateTimeField(null=True, blank=True)
    ultima_inspecao_em = models.DateTimeField(
        null=True, blank=True, help_text="Data da inspeção validada mais recente."
    )

    origem_registro = models.CharField(max_length=20, choices=OrigemRegistro.choices)
    lote = models.ForeignKey(
        "LoteImportacao", null=True, blank=True, on_delete=models.PROTECT, related_name="arvores"
    )
    criado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    observacoes = models.TextField(blank=True)

    class Meta:
        ordering = ["-numero"]
        indexes = [models.Index(fields=["situacao"]), models.Index(fields=["especie_estado"])]

    def __str__(self) -> str:
        return self.codigo

    @property
    def codigo(self) -> str:
        return f"ARV-{self.numero:06d}" if self.numero else "ARV-?"

    @property
    def valida(self) -> bool:
        """Registro válido (RN-INV-001, provisório até DP-14)."""
        return (
            self.situacao == SituacaoArvore.ATIVA
            and self.geom is not None
            and bool(self.localizacao_origem)
        )

    def save(self, *args, **kwargs):
        campos = kwargs.get("update_fields")
        if not self.numero:
            self.numero = proximo_numero("inventario_arvore_numero_seq")
        if campos is None or "geom" in campos:
            # Bairro sempre derivado da geometria, nunca informado à mão.
            self.bairro = bairro_do_ponto(self.geom)
            if campos is not None:
                kwargs["update_fields"] = {*campos, "bairro"}
        super().save(*args, **kwargs)


@pghistory.track(*eventos())
class IdentificadorExterno(ModeloBase):
    arvore = models.ForeignKey(Arvore, on_delete=models.CASCADE, related_name="identificadores")
    fonte = models.CharField(max_length=100)
    valor = models.CharField(max_length=100)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["fonte", "valor"], name="identificador_externo_unico")
        ]


class TipoMedida(models.TextChoices):
    ALTURA = "altura", "Altura total"
    DAP = "dap", "DAP (diâmetro à altura do peito)"
    CAP = "cap", "CAP (circunferência à altura do peito)"
    DIAMETRO_COPA = "diametro_copa", "Diâmetro da copa"
    ALTURA_PRIMEIRA_BIFURCACAO = "altura_bifurcacao", "Altura da 1ª bifurcação"


class MetodoMedida(models.TextChoices):
    FITA_DIAMETRICA = "fita_diametrica", "Fita diamétrica"
    FITA_METRICA = "fita_metrica", "Fita métrica"
    TRENA = "trena", "Trena"
    HIPSOMETRO = "hipsometro", "Hipsômetro"
    CLINOMETRO = "clinometro", "Clinômetro"
    VISUAL = "visual", "Estimativa visual"
    IMAGEM = "imagem", "Estimativa por imagem"
    DESCONHECIDO = "desconhecido", "Não informado pela fonte"


UNIDADES_POR_TIPO = {
    TipoMedida.ALTURA: "m",
    TipoMedida.DAP: "cm",
    TipoMedida.CAP: "cm",
    TipoMedida.DIAMETRO_COPA: "m",
    TipoMedida.ALTURA_PRIMEIRA_BIFURCACAO: "m",
}


@pghistory.track(*eventos())
class Medida(ModeloBase):
    """Medida com método, unidade, data, responsável e origem (RN-INV-002)."""

    arvore = models.ForeignKey(Arvore, on_delete=models.CASCADE, related_name="medidas")
    tipo = models.CharField(max_length=30, choices=TipoMedida.choices)
    valor = models.DecimalField(max_digits=8, decimal_places=2)
    unidade = models.CharField(max_length=10)
    metodo = models.CharField(max_length=30, choices=MetodoMedida.choices)
    origem = models.CharField(max_length=20, choices=OrigemValor.choices)
    data_medicao = models.DateField(null=True, blank=True)
    responsavel = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    inspecao = models.ForeignKey(
        "inspecoes.Inspecao",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="medidas",
    )
    aplicada = models.BooleanField(
        default=True,
        help_text="Medidas de inspeção só entram no cadastro quando o revisor as aplica.",
    )
    responsavel_texto = models.CharField(
        max_length=200, blank=True, help_text="Responsável como informado pela fonte importada."
    )
    observacao = models.TextField(blank=True)

    class Meta:
        ordering = ["-data_medicao", "-criado_em"]


class EstadoLote(models.TextChoices):
    PRE_VISUALIZADO = "pre_visualizado", "Pré-visualizado"
    CONFIRMADO = "confirmado", "Confirmado"
    DESFEITO = "desfeito", "Desfeito"
    DESCARTADO = "descartado", "Descartado"


@pghistory.track(*eventos(), exclude=["linhas"])
class LoteImportacao(ModeloBase):
    """Importação em lote de inventário (RF-INV-010 a 012)."""

    numero = models.BigIntegerField(unique=True, editable=False)
    arquivo_nome = models.CharField(max_length=255)
    formato = models.CharField(max_length=10)
    fonte = models.CharField(max_length=200)
    fonte_url = models.URLField(max_length=500, blank=True)
    data_referencia = models.DateField(null=True, blank=True)
    mapeamento = models.JSONField(default=dict)
    estado = models.CharField(
        max_length=20, choices=EstadoLote.choices, default=EstadoLote.PRE_VISUALIZADO
    )
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    total_linhas = models.PositiveIntegerField(default=0)
    linhas_validas = models.PositiveIntegerField(default=0)
    linhas = models.JSONField(default=list, help_text="Linhas interpretadas na pré-visualização.")
    confirmado_em = models.DateTimeField(null=True, blank=True)
    desfeito_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-numero"]

    def save(self, *args, **kwargs):
        if not self.numero:
            self.numero = proximo_numero("inventario_lote_numero_seq")
        super().save(*args, **kwargs)


@pghistory.track(*eventos())
class ParNaoDuplicado(ModeloBase):
    """Par de árvores revisado e declarado **não** duplicado (RF-INV-014)."""

    arvore_a = models.ForeignKey(Arvore, on_delete=models.CASCADE, related_name="+")
    arvore_b = models.ForeignKey(Arvore, on_delete=models.CASCADE, related_name="+")
    revisado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["arvore_a", "arvore_b"], name="par_nao_duplicado_unico"
            ),
            models.CheckConstraint(
                condition=models.Q(arvore_a__lt=models.F("arvore_b")), name="par_ordenado"
            ),
        ]
