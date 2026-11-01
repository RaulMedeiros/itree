from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.alertas import fontes
from itree.alertas.models import FonteAlerta


class Command(BaseCommand):
    help = "Ingere alertas ambientais de um arquivo ou URL (idempotente)."

    def add_arguments(self, parser):
        parser.add_argument("--fonte", required=True, choices=FonteAlerta.values)
        origem = parser.add_mutually_exclusive_group(required=True)
        origem.add_argument("--arquivo")
        origem.add_argument("--url")

    def handle(self, *args, fonte, arquivo, url, **opts):
        try:
            conteudo = Path(arquivo).read_bytes() if arquivo else fontes.baixar(url)
        except Exception as exc:  # noqa: BLE001
            raise CommandError(f"Não foi possível obter os dados: {exc}") from exc
        r = fontes.ingerir(fonte, conteudo, arquivo or url)
        if not r.sucesso:
            raise CommandError(r.erro)
        self.stdout.write(
            self.style.SUCCESS(
                f"{r.recebidos} recebidos: {r.novos} novos, {r.ja_existentes} já existentes, "
                f"{r.fora_do_municipio} fora do município, {r.invalidos} inválidos."
            )
        )
