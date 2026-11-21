"""Importa o IDH 2010 por bairro (SDE, Prefeitura de Fortaleza, via Fortaleza em Mapas).

    manage.py importar_idh_bairros                  # baixa o GeoJSON do Mapas (id 35)
    manage.py importar_idh_bairros --arquivo x.json

Dado de 2010, com limites de bairro da época: os bairros sem nome equivalente não recebem valor.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.indicadores import populacao as pop


class Command(BaseCommand):
    help = "Importa o IDH 2010 por bairro (e as dimensões educação, longevidade e renda)."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo", help="GeoJSON local, no lugar do download.")
        parser.add_argument("--url", default=pop.URL_IDH)

    def handle(self, *args, arquivo=None, url=pop.URL_IDH, **opts):
        try:
            conteudo = Path(arquivo).read_bytes() if arquivo else pop.baixar(url)
            versao = pop.ler_idh(conteudo).versao
            r = pop.executar(
                pop.FONTE_IDH,
                "manual",
                versao,
                2010,
                lambda: pop.importar_idh(conteudo, fonte_url=url),
                propagar=True,
            )["resumo"]
        except Exception as exc:  # noqa: BLE001
            raise CommandError(f"Não foi possível importar: {exc}") from exc
        self.stdout.write(self.style.SUCCESS(f"{r['gravados']} bairro(s) gravado(s) ({versao})."))
        if r["sem_casamento_no_arquivo"]:
            self.stdout.write(
                self.style.WARNING(
                    f"{len(r['sem_casamento_no_arquivo'])} bairro(s) do IDH sem bairro atual: "
                    + ", ".join(r["sem_casamento_no_arquivo"])
                )
            )
        if r["bairros_sem_dado"]:
            self.stdout.write(
                self.style.WARNING(
                    f"{len(r['bairros_sem_dado'])} bairro(s) atuais sem IDH: "
                    + ", ".join(r["bairros_sem_dado"])
                )
            )
