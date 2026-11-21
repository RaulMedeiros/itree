"""Detecção automática de árvores (decisões de 21/11/2026).

Um projeto externo detecta árvores em vídeo de carros e em imagens de satélite e as envia em
**lotes**. Cada detecção vira uma **observação** de uma árvore do inventário (existente ou nova,
com selo de confiança e origem); berços vazios e tocos viram **pontos de plantio possível**; árvore
conhecida que um lote não viu vira um **sinal de possível remoção** para revisão humana. Nada é
removido sozinho.
"""

import pghistory
from django.conf import settings
from django.contrib.gis.db import models
from django.contrib.postgres.fields import ArrayField

from itree.core.auditoria import eventos
from itree.core.models import ModeloBase


class TokenIntegracao(ModeloBase):
    """Token de máquina de uma integração (ex.: o projeto de detecção).

    O valor do token só existe no momento da criação (mostrado uma única vez); aqui fica o hash
    SHA-256 e o prefixo, que identifica o token na lista. Escopo territorial e permissões são
    próprios do token. Não há auditoria por ``pghistory`` do hash: ele não deve ir para o
    histórico; a criação e a revogação ficam registradas no próprio modelo.
    """

    nome = models.CharField(max_length=150, unique=True)
    prefixo = models.CharField(max_length=12, editable=False)
    hash = models.CharField(max_length=64, unique=True, editable=False)
    permissoes = ArrayField(models.CharField(max_length=40), default=list)
    territorios = models.ManyToManyField(
        "territorio.Territorio",
        related_name="tokens_integracao",
        help_text="Escopo territorial: o token só envia detecções dentro destes territórios.",
    )
    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="token_integracao",
        editable=False,
        help_text="Usuário de serviço, inativo para login, que assina o que o token cria.",
    )
    criado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    revogado_em = models.DateTimeField(null=True, blank=True)
    revogado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    ultimo_uso_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-criado_em"]

    def __str__(self) -> str:
        return self.nome

    @property
    def ativo(self) -> bool:
        return self.revogado_em is None

    def tem_permissao(self, permissao: str) -> bool:
        return self.ativo and permissao in self.permissoes


class Sensor(models.TextChoices):
    SATELITE = "satelite", "Satélite"
    VIDEO_RUA = "video_rua", "Vídeo de rua"


class CanalLote(models.TextChoices):
    API = "api", "API"
    PACOTE = "pacote", "Pacote (ZIP)"


class SituacaoLote(models.TextChoices):
    RECEBIDO = "recebido", "Recebido"
    EM_PROCESSAMENTO = "em_processamento", "Em processamento"
    CONCLUIDO = "concluido", "Concluído"
    FALHOU = "falhou", "Interrompido por erro"


@pghistory.track(*eventos(), exclude=["carga", "erros"])
class LoteDeteccao(ModeloBase):
    """Lote de detecções recebido (API ou pacote): situação, contagens, erros e quem enviou."""

    id_externo = models.CharField(max_length=100, help_text="Identificador do lote na origem.")
    projeto_origem = models.CharField(max_length=150)
    versao_modelo = models.CharField(max_length=100)
    sensor = models.CharField(max_length=10, choices=Sensor.choices)
    capturado_em = models.DateField(help_text="Data da captura das imagens.")
    area_coberta = models.MultiPolygonField(
        srid=4326,
        null=True,
        blank=True,
        help_text="Área que o lote cobre. Sem ela não há sinal de possível remoção.",
    )
    canal = models.CharField(max_length=10, choices=CanalLote.choices)
    arquivo_nome = models.CharField(max_length=255, blank=True)
    integracao = models.ForeignKey(
        TokenIntegracao, null=True, blank=True, on_delete=models.PROTECT, related_name="lotes"
    )
    enviado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    situacao = models.CharField(
        max_length=20, choices=SituacaoLote.choices, default=SituacaoLote.RECEBIDO
    )
    total = models.PositiveIntegerField(default=0, help_text="Detecções recebidas.")
    processadas = models.PositiveIntegerField(
        default=0, help_text="Ponto de retomada: itens da carga já tratados."
    )
    arvores_criadas = models.PositiveIntegerField(default=0)
    arvores_juntadas = models.PositiveIntegerField(
        default=0, help_text="Árvores conhecidas que receberam observação (sem contar repetidas)."
    )
    recusadas = models.PositiveIntegerField(default=0)
    pontos_criados = models.PositiveIntegerField(default=0, help_text="Pontos de plantio novos.")
    possiveis_remocoes = models.PositiveIntegerField(default=0)
    erros = models.JSONField(
        default=list, blank=True, help_text="[{id, motivo}] das recusas, até o limite guardado."
    )
    erro = models.TextField(blank=True, help_text="Por que o processamento foi interrompido.")
    carga = models.JSONField(
        default=dict,
        blank=True,
        help_text="Detecções e fotos já validadas, à espera do processamento; esvaziada ao fim.",
    )
    processado_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-criado_em"]
        constraints = [
            models.UniqueConstraint(
                fields=["projeto_origem", "id_externo"], name="lote_deteccao_unico"
            )
        ]

    def __str__(self) -> str:
        return f"{self.projeto_origem}/{self.id_externo}"


class ResultadoObservacao(models.TextChoices):
    CRIOU = "criou", "Criou uma árvore"
    JUNTOU = "juntou", "Juntou-se a uma árvore existente"


@pghistory.track(*eventos(), exclude=["valores"])
class Observacao(ModeloBase):
    """Uma passagem de um lote por uma árvore: origem, confiança, data, valores e fotos."""

    arvore = models.ForeignKey(
        "inventario.Arvore", on_delete=models.CASCADE, related_name="observacoes_deteccao"
    )
    lote = models.ForeignKey(LoteDeteccao, on_delete=models.CASCADE, related_name="observacoes")
    id_deteccao = models.CharField(max_length=100)
    id_rastreamento = models.CharField(max_length=100, blank=True)
    sensor = models.CharField(max_length=10, choices=Sensor.choices)
    resultado = models.CharField(max_length=10, choices=ResultadoObservacao.choices)
    confianca = models.FloatField()
    capturada_em = models.DateField()
    geom = models.PointField(srid=4326)
    incerteza_m = models.FloatField()
    valores = models.JSONField(
        default=dict,
        help_text="Espécies candidatas, medidas estimadas, copa, contexto, interferências, "
        "sinais, qualidade da imagem e versão do modelo, como recebidos.",
    )

    class Meta:
        ordering = ["-capturada_em", "-criado_em"]
        constraints = [
            models.UniqueConstraint(fields=["lote", "id_deteccao"], name="observacao_unica")
        ]
        indexes = [models.Index(fields=["arvore", "-capturada_em"])]


class TipoPontoPlantio(models.TextChoices):
    BERCO_VAZIO = "berco_vazio", "Berço vazio"
    TOCO = "toco", "Toco"


class SituacaoPontoPlantio(models.TextChoices):
    ABERTO = "aberto", "Aberto"
    PLANTADO = "plantado", "Plantado"
    DESCARTADO = "descartado", "Descartado"


@pghistory.track(*eventos())
class PontoPlantio(ModeloBase):
    """Ponto de plantio possível: berço vazio ou toco visto por uma detecção.

    Modelo leve, sem ser árvore: aparece como camada no mapa e alimenta o "Onde plantar".
    """

    lote = models.ForeignKey(LoteDeteccao, on_delete=models.CASCADE, related_name="pontos_plantio")
    id_deteccao = models.CharField(max_length=100)
    tipo = models.CharField(max_length=15, choices=TipoPontoPlantio.choices)
    geom = models.PointField(srid=4326)
    incerteza_m = models.FloatField()
    confianca = models.FloatField()
    contexto = models.CharField(max_length=20, blank=True)
    capturado_em = models.DateField()
    ultima_vez_visto_em = models.DateField()
    situacao = models.CharField(
        max_length=12, choices=SituacaoPontoPlantio.choices, default=SituacaoPontoPlantio.ABERTO
    )
    bairro = models.ForeignKey(
        "territorio.Territorio", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-capturado_em", "-criado_em"]
        constraints = [
            models.UniqueConstraint(fields=["lote", "id_deteccao"], name="ponto_plantio_unico")
        ]


class SituacaoSinal(models.TextChoices):
    PENDENTE = "pendente", "Para revisar"
    REMOCAO_CONFIRMADA = "remocao_confirmada", "Remoção confirmada"
    DESCARTADO = "descartado", "Descartado"


@pghistory.track(*eventos())
class SinalRemocao(ModeloBase):
    """Árvore conhecida, na área coberta por um lote, que o lote não viu (RN: nunca automático)."""

    arvore = models.ForeignKey(
        "inventario.Arvore", on_delete=models.CASCADE, related_name="sinais_remocao"
    )
    lote = models.ForeignKey(LoteDeteccao, on_delete=models.CASCADE, related_name="sinais_remocao")
    situacao = models.CharField(
        max_length=20, choices=SituacaoSinal.choices, default=SituacaoSinal.PENDENTE
    )
    decidido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    decidido_em = models.DateTimeField(null=True, blank=True)
    motivo = models.TextField(blank=True)

    class Meta:
        ordering = ["-criado_em"]
        constraints = [
            models.UniqueConstraint(fields=["arvore", "lote"], name="sinal_remocao_unico")
        ]
