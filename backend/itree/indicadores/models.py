"""Modelos dos indicadores: instantâneos diários da visão geral, indicadores por bairro de fontes
externas (Censo, IDH, SEFIN, UrbVerde), resultado da regra 3-30-300, execuções das importações
e dados da URBFOR (doação de mudas e plantio). Cada valor guarda fonte, método e data."""

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
        max_digits=14, decimal_places=4, null=True, blank=True, help_text="Vazio sem base."
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
    versao = models.CharField(
        max_length=60,
        blank=True,
        help_text="Versão do arquivo na fonte (por exemplo, o sufixo de data do IBGE).",
    )

    class Meta:
        ordering = ["indicador", "territorio__nome"]
        constraints = [
            models.UniqueConstraint(
                fields=["territorio", "indicador"], name="indicador_externo_unico"
            )
        ]

    def __str__(self) -> str:
        return f"{self.indicador} ({self.territorio_id})"


class ResultadoRegra330300(models.Model):
    """Regra 3-30-300 de um bairro, calculada pelo comando ``calcular_3_30_300`` (nunca na
    requisição) e gravada por bairro, data e tipo de contagem de árvores.

    Cada parte guarda numerador e denominador (para somar bairros sem perder a proporção) e fica
    vazia, nunca zero, quando falta a fonte. O método e as aproximações estão em
    ``docs/indicadores/3-30-300.md`` e em ``regra_3_30_300.METODO``.
    """

    bairro = models.ForeignKey(
        Territorio, on_delete=models.CASCADE, related_name="resultados_3_30_300"
    )
    data = models.DateField(help_text="Dia do cálculo.")
    contagem = models.CharField(max_length=20, help_text='"todas" ou "confirmadas" (árvores).')
    base_edificacoes = models.CharField(
        max_length=20, help_text='"residenciais" ou "todas" (sem classificação por uso).'
    )
    edificacoes = models.PositiveIntegerField(help_text="Edificações da base no bairro.")
    # "3": com 3 árvores ou mais a até 30 m.
    com_3_arvores = models.PositiveIntegerField(null=True, blank=True)
    # "30": pixels com vegetação (NDVI >= limiar) e pixels do bairro com medição.
    pixels_vegetacao = models.PositiveIntegerField(null=True, blank=True)
    pixels_medidos = models.PositiveIntegerField(null=True, blank=True)
    # "300": edificações a até 300 m de área verde pública de 0,5 ha ou mais.
    perto_de_area_verde = models.PositiveIntegerField(null=True, blank=True)
    calculado_em = models.DateTimeField()
    metadados = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-data", "bairro__nome"]
        constraints = [
            models.UniqueConstraint(
                fields=["bairro", "data", "contagem"], name="resultado_3_30_300_unico"
            )
        ]
        indexes = [models.Index(fields=["contagem", "-data"], name="res_3_30_300_contagem_idx")]

    def __str__(self) -> str:
        return f"3-30-300 {self.bairro_id} {self.data} ({self.contagem})"


class ExecucaoFonteExterna(models.Model):
    """Cada execução da importação ou da conferência mensal de uma fonte externa de bairros
    (população, renda, IDH). Alimenta "Fontes dos dados" e o aviso de fonte desatualizada."""

    fonte = models.CharField(max_length=40, help_text="Id da fonte (ver populacao.FONTES).")
    iniciada_em = models.DateTimeField()
    concluida_em = models.DateTimeField(null=True, blank=True)
    sucesso = models.BooleanField(default=False)
    importou = models.BooleanField(
        default=False, help_text="Falso quando a conferência não achou versão nova."
    )
    versao = models.CharField(max_length=60, blank=True)
    ano_referencia = models.PositiveSmallIntegerField(null=True, blank=True)
    origem = models.CharField(max_length=20, default="manual", help_text="manual ou agendada.")
    resumo = models.JSONField(default=dict, blank=True)
    erro = models.TextField(blank=True)

    class Meta:
        ordering = ["-iniciada_em"]
        indexes = [models.Index(fields=["fonte", "-iniciada_em"])]

    def __str__(self) -> str:
        return f"{self.fonte} {self.iniciada_em:%Y-%m-%d} ({'ok' if self.sucesso else 'falha'})"


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
