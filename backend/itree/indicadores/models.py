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
