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
