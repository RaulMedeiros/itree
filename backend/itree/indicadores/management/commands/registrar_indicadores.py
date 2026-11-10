from datetime import date

from django.core.management.base import BaseCommand, CommandError

from itree.indicadores import instantaneos


class Command(BaseCommand):
    help = "Registra os indicadores instantâneos da visão geral para cada território (M-11)."

    def add_arguments(self, parser):
        parser.add_argument("--data", help="AAAA-MM-DD (padrão: hoje)")

    def handle(self, *args, data=None, **opcoes):
        try:
            dia = date.fromisoformat(data) if data else None
        except ValueError as exc:
            raise CommandError("Use --data AAAA-MM-DD.") from exc
        total = instantaneos.registrar(dia)
        self.stdout.write(f"{total} registros de indicadores gravados.")
