"""Importa por bairro o IPTU médio e as inscrições de 2024 e as áreas edificadas residencial e
comercial de 2021 (SEFIN, via Fortaleza em Mapas: mapas 769, 771, 122 e 118).

    manage.py importar_indicadores_sefin
    manage.py importar_indicadores_sefin --indicador iptu_medio_2024 --arquivo x.json
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.imoveis import sefin_bairros as sefin
from itree.indicadores import populacao as pop


class Command(BaseCommand):
    help = "Importa IPTU e áreas edificadas por bairro (SEFIN)."

    def add_arguments(self, parser):
        parser.add_argument("--indicador", choices=sefin.INDICADORES, action="append")
        parser.add_argument("--arquivo", help="GeoJSON local (com um só --indicador).")

    def handle(self, *args, indicador=None, arquivo=None, **opts):
        alvos = indicador or sefin.INDICADORES
        if arquivo and len(alvos) != 1:
            raise CommandError("--arquivo exige exatamente um --indicador.")
        for ind in alvos:
            try:
                conteudo = (
                    Path(arquivo).read_bytes()
                    if arquivo
                    else pop.baixar(f"{sefin.URL_MAPA}{sefin.FONTES[ind]['mapa']}")
                )
                r = sefin.importar(ind, conteudo)
            except Exception as exc:  # noqa: BLE001
                raise CommandError(f"{ind}: não foi possível importar: {exc}") from exc
            self.stdout.write(self.style.SUCCESS(f"{ind}: {r['gravados']} bairro(s) gravado(s)."))
            if r["sem_casamento"]:
                self.stdout.write(
                    self.style.WARNING("sem bairro atual: " + ", ".join(r["sem_casamento"]))
                )
            if r["bairros_sem_dado"]:
                self.stdout.write(
                    self.style.WARNING("bairros sem dado: " + ", ".join(r["bairros_sem_dado"]))
                )
