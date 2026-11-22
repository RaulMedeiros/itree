"""Calcula a regra 3-30-300 por bairro e grava o resultado (cálculo pesado, fora da requisição).

    manage.py calcular_3_30_300

Antes: ``importar_limites_fortaleza``, ``importar_areas_verdes``, ``importar_edificacoes``, e,
para as partes que dependem deles, ``importar_uso_lotes_sefin`` (uso do lote) e
``importar_cobertura_vegetal`` (NDVI). Cada parte sem fonte fica sem dado, nunca zero.
"""

import time

from django.core.management.base import BaseCommand

from itree.indicadores import regra_3_30_300


class Command(BaseCommand):
    help = "Calcula a regra 3-30-300 por bairro."

    def handle(self, *args, **opts):
        inicio = time.monotonic()
        r = regra_3_30_300.calcular()
        self.stdout.write(
            self.style.SUCCESS(
                f"Regra 3-30-300 de {r['bairros']} bairro(s) em {time.monotonic() - inicio:.0f} s: "
                f"{r['edificacoes']} edificações (base: {r['base']}), {r['areas_verdes']} áreas "
                f"verdes de 0,5 ha ou mais, {r['bairros_com_vegetacao']} bairro(s) com cobertura "
                f"vegetal."
            )
        )
