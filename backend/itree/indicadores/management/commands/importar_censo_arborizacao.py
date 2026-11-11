"""Importa a arborização do entorno por bairro (Censo 2022, IBGE). Idempotente.

    manage.py importar_censo_arborizacao                 # baixa o ZIP do FTP do IBGE
    manage.py importar_censo_arborizacao --arquivo x.zip # ZIP ou CSV local

Só entram os bairros já cadastrados cujo ``codigo`` é o código IBGE do bairro
(ex.: 2304400001). Importe os bairros antes.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.indicadores import externos


class Command(BaseCommand):
    help = "Importa o percentual de faces de quadra com árvore, por bairro (Censo 2022)."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo", help="ZIP ou CSV local, no lugar do download.")
        parser.add_argument("--url", default=externos.URL_CENSO_FACES)

    def handle(self, *args, arquivo=None, url=externos.URL_CENSO_FACES, **opts):
        try:
            conteudo = Path(arquivo).read_bytes() if arquivo else externos.baixar(url)
        except Exception as exc:  # noqa: BLE001
            raise CommandError(f"Não foi possível obter os dados: {exc}") from exc
        try:
            r = externos.importar(conteudo, fonte_url=url)
        except externos.CensoInvalido as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(f"{r.gravados} bairro(s) gravado(s)."))
        if r.inconsistentes:
            self.stdout.write(
                self.style.WARNING(f"{r.inconsistentes} linha(s) descartada(s) por inconsistência.")
            )
        if r.bairros_sem_dado:
            self.stdout.write(
                self.style.WARNING(
                    f"{len(r.bairros_sem_dado)} bairro(s) cadastrado(s) sem dado no Censo "
                    f"(código IBGE ausente ou diferente): {', '.join(r.bairros_sem_dado[:10])}"
                    + ("…" if len(r.bairros_sem_dado) > 10 else "")
                )
            )
