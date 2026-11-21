"""Importa o Macrozoneamento Urbano de Fortaleza (SEUMA, 2022; Fortaleza em Mapas, mapa 604).

manage.py importar_macrozoneamento
manage.py importar_macrozoneamento --arquivo macrozoneamento.geojson
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.imoveis import macrozoneamento
from itree.indicadores import populacao as pop


class Command(BaseCommand):
    help = "Importa as zonas do Macrozoneamento Urbano (contexto, só leitura)."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo", help="GeoJSON local, no lugar do download.")

    def handle(self, *args, arquivo=None, **opts):
        try:
            conteudo = (
                Path(arquivo).read_bytes() if arquivo else pop.baixar(macrozoneamento.URL_GEOJSON)
            )
            r = macrozoneamento.importar(conteudo)
        except (macrozoneamento.FonteInvalida, OSError, Exception) as exc:  # noqa: BLE001
            raise CommandError(f"Não foi possível importar: {exc}") from exc
        self.stdout.write(
            self.style.SUCCESS(f"{r['zonas']} zona(s) importada(s), {r['removidas']} removida(s).")
        )
