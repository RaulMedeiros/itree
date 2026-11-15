from django.db import models

from itree.territorio.models import Territorio


class RegistroIndicador(models.Model):
    """Valor de um indicador instantâneo em um dia, por território (M-11).

    Os instantâneos (ex.: espécie confirmada) não têm histórico por si; a tarefa
    diária guarda numerador e denominador, não o percentual, para que a visão
    geral some territórios (bairros) sem perder a proporção.
    """

    data = models.DateField(help_text="Dia a que o valor se refere.")
    territorio = models.ForeignKey(
        Territorio, on_delete=models.CASCADE, related_name="registros_indicadores"
    )
    indicador = models.CharField(max_length=60, help_text="Id do indicador na visão geral.")
    numerador = models.IntegerField()
    denominador = models.IntegerField(
        null=True, blank=True, help_text="Base do percentual; vazio para contagens."
    )
    registrado_em = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["data", "indicador"]
        constraints = [
            models.UniqueConstraint(
                fields=["data", "territorio", "indicador"], name="registro_indicador_unico"
            )
        ]

    def __str__(self) -> str:
        return f"{self.indicador} {self.data} ({self.territorio_id})"


class IndicadorTerritorialExterno(models.Model):
    """Indicador por território vindo de fonte pública externa (ex.: Censo 2022).

    Fica separado de ``RegistroIndicador`` de propósito: o valor não é calculado
    pela plataforma e não muda a cada dia. Cada linha guarda numerador e
    denominador (para somar bairros sem perder a proporção) e a proveniência
    completa exigida pelo RF-INT-001: órgão, URL, licença ou termos, data de
    referência, data de ingestão, definição e método.
    """

    territorio = models.ForeignKey(
        Territorio, on_delete=models.CASCADE, related_name="indicadores_externos"
    )
    indicador = models.CharField(max_length=60, help_text="Id do indicador.")
    valor = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, help_text="Vazio sem base."
    )
    numerador = models.BigIntegerField()
    denominador = models.BigIntegerField(null=True, blank=True)
    unidade = models.CharField(max_length=20, blank=True)

    fonte = models.CharField(max_length=200)
    fonte_url = models.URLField(max_length=500, blank=True)
    licenca = models.CharField(max_length=300, blank=True, help_text="Licença ou termos de uso.")
    data_referencia = models.DateField(
        null=True, blank=True, help_text="Data a que o dado se refere na fonte."
    )
    ingerido_em = models.DateTimeField(help_text="Quando o dado foi ingerido no sistema.")
    definicao = models.TextField()
    metodo = models.TextField(help_text="Como o valor foi obtido a partir da fonte.")

    class Meta:
        ordering = ["indicador", "territorio__nome"]
        constraints = [
            models.UniqueConstraint(
                fields=["territorio", "indicador"], name="indicador_externo_unico"
            )
        ]

    def __str__(self) -> str:
        return f"{self.indicador} ({self.territorio_id})"


class TipoBeneficiario(models.TextChoices):
    PESSOA_FISICA = "pf", "Pessoa física"
    PESSOA_JURIDICA = "pj", "Pessoa jurídica"


class CategoriaMuda(models.TextChoices):
    ORNAMENTAL = "ornamental", "Ornamental"
    NATIVA_FRUTIFERA = "nativa_frutifera", "Nativa ou frutífera"
    PALMEIRA = "palmeira", "Palmeira"
    MEDICINAL = "medicinal", "Medicinal"


class ProvenienciaExterna(models.Model):
    """Proveniência exigida pelo RF-INT-001 para o dado de fonte pública externa."""

    fonte = models.CharField(max_length=200)
    fonte_url = models.URLField(max_length=500, blank=True)
    licenca = models.CharField(max_length=300, blank=True, help_text="Licença ou termos de uso.")
    data_referencia = models.DateField(
        null=True, blank=True, help_text="Data a que o dado se refere na fonte."
    )
    ingerido_em = models.DateTimeField(help_text="Quando o dado foi ingerido no sistema.")

    class Meta:
        abstract = True


class DoacaoMudas(ProvenienciaExterna):
    """Mudas doadas pela URBFOR numa ficha de atendimento, por espécie (F-04, planilhas de 2022).

    Uma linha por espécie de cada ficha. **Não guarda requerente nem endereço**: na doação a
    pessoa física informa o próprio nome, e a planilha não tem local de plantio. Por isso o
    dado não vai ao mapa. A espécie fica como veio na planilha; ``especie`` só é preenchida
    quando o nome casa, sem ambiguidade, com o catálogo."""

    ano = models.PositiveSmallIntegerField(help_text="Ano do título do mês na planilha.")
    mes = models.PositiveSmallIntegerField(null=True, blank=True)
    data = models.DateField(null=True, blank=True, help_text="Vazia quando a ficha não tem data.")
    beneficiario = models.CharField(max_length=2, choices=TipoBeneficiario.choices)
    categoria = models.CharField(
        max_length=20,
        choices=CategoriaMuda.choices,
        blank=True,
        help_text="Vazia se a planilha não diz.",
    )
    categoria_via = models.CharField(
        max_length=20,
        blank=True,
        help_text='"planilha" (coluna da linha) ou "lista_auxiliar" (aba de nomes da planilha).',
    )
    especie_texto = models.CharField(max_length=200)
    especie = models.ForeignKey(
        "inventario.Especie", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    especie_via = models.CharField(
        max_length=20, blank=True, help_text='"cientifico" ou "nome_popular".'
    )
    quantidade = models.PositiveIntegerField()
    linha_origem = models.PositiveIntegerField(help_text="Linha da planilha, para conferência.")

    class Meta:
        ordering = ["ano", "mes", "data", "linha_origem"]
        indexes = [models.Index(fields=["ano", "beneficiario"])]

    def __str__(self) -> str:
        return f"{self.especie_texto} ×{self.quantidade} ({self.beneficiario} {self.ano})"


class MotivoSemBairro(models.TextChoices):
    SEM_TEXTO = "sem_bairro_no_texto", "Endereço sem bairro no texto"
    NAO_RECONHECIDO = "nao_reconhecido", "Bairro do texto não reconhecido"
    AMBIGUO = "ambiguo", "Nome que serve a dois bairros"
    SEM_ENDERECO = "sem_endereco", "Sem endereço (só o local)"


class RegistroPlantio(ProvenienciaExterna):
    """Plantio de mudas registrado pela URBFOR numa ficha (F-04, planilha de 2022).

    O endereço é um texto de equipamento ou via pública. **Não é geocodificado e não gera árvore**
    (DP-18): ``bairro`` vem só do texto do endereço, pelos mesmos aliases do manejo da URBFOR, e
    fica vazio, com o motivo, quando o texto não permite. As mudas são, em grande parte, de
    porte pequeno (ornamentais, "mini lacre"), e não de árvores do inventário."""

    ano = models.PositiveSmallIntegerField(help_text="Ano do título do mês na planilha.")
    mes = models.PositiveSmallIntegerField(null=True, blank=True)
    data = models.DateField(null=True, blank=True, help_text="Vazia quando a ficha não tem data.")
    data_fim = models.DateField(null=True, blank=True, help_text="Só nas fichas com período.")
    endereco = models.CharField(max_length=300, blank=True)
    local = models.CharField(max_length=300, blank=True)
    bairro = models.ForeignKey(
        Territorio, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    motivo_sem_bairro = models.CharField(max_length=30, choices=MotivoSemBairro.choices, blank=True)
    especies = models.JSONField(
        default=list, help_text="Lista de {especie, categoria, quantidade} da ficha."
    )
    total_mudas = models.PositiveIntegerField()
    total_declarado = models.PositiveIntegerField(
        null=True, blank=True, help_text="Total que a planilha informa; vazio se não informa."
    )
    linha_origem = models.PositiveIntegerField(help_text="Linha da planilha, para conferência.")

    class Meta:
        ordering = ["ano", "mes", "data", "linha_origem"]

    def __str__(self) -> str:
        return f"Plantio {self.data or self.ano}: {self.total_mudas} mudas"
