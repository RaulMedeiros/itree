"""Calcula a cobertura vegetal por bairro pelo NDVI de 10 m (o "30" da regra 3-30-300).

    manage.py importar_cobertura_vegetal                    # WCS da UrbVerde (NDVI-10m-2021)
    manage.py importar_cobertura_vegetal --arquivo ndvi.tif # GeoTIFF local de NDVI de 10 m
    manage.py importar_cobertura_vegetal --limiar 0.5

Só grava com ``URBVERDE_GRAVAR_VALORES`` ligado (termos da UrbVerde). Em 21/11/2026 o WCS da
UrbVerde não serve Fortaleza; veja ``itree.indicadores.vegetacao``.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.indicadores import ilha_calor, vegetacao


class Command(BaseCommand):
    help = "Cobertura vegetal por bairro (NDVI de 10 m)."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo", help="GeoTIFF local de NDVI, no lugar do WCS.")
        parser.add_argument("--limiar", type=float, help="NDVI mínimo de vegetação (0,4).")

    def handle(self, *args, arquivo=None, limiar=None, **opts):
        try:
            conteudo = Path(arquivo).read_bytes() if arquivo else vegetacao.baixar()
            r = vegetacao.importar(conteudo, limiar_ndvi=limiar)
        except (ilha_calor.RasterInvalido, OSError, Exception) as exc:  # noqa: BLE001
            raise CommandError(f"Não foi possível calcular a cobertura vegetal: {exc}") from exc
        corte = vegetacao.limiar() if limiar is None else limiar
        gravou = ilha_calor.gravar_permitido()
        self.stdout.write(
            f"{len(r.medidas)} bairro(s) medido(s) (limiar NDVI {corte:g}); "
            + (
                f"cidade: {r.media_cidade:.1f}% de vegetação. "
                if r.media_cidade is not None
                else "sem pixel medido. "
            )
            + (
                "Valores gravados."
                if gravou
                else "Nada gravado (URBVERDE_GRAVAR_VALORES desligado)."
            )
        )
        if r.sem_medicao:
            self.stdout.write(self.style.WARNING("sem medição: " + ", ".join(r.sem_medicao)))
