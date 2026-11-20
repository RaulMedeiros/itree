from django.core.management.base import BaseCommand, CommandError

from itree.core import armazenamento
from itree.evidencias.miniaturas import TIPOS_COM_MINIATURA, gerar_miniatura
from itree.evidencias.models import EstadoEvidencia, Evidencia


class Command(BaseCommand):
    help = "Gera as miniaturas das fotos disponíveis que ainda não têm (idempotente)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--refazer", action="store_true", help="Refaz também as que já têm miniatura."
        )

    def handle(self, *args, refazer=False, **opcoes):
        if not armazenamento.s3_configurado():
            raise CommandError("O armazenamento de arquivos não está configurado.")
        fotos = Evidencia.objects.filter(
            estado=EstadoEvidencia.DISPONIVEL, tipo_conteudo__in=TIPOS_COM_MINIATURA
        )
        if not refazer:
            fotos = fotos.filter(chave_miniatura="")
        geradas = falhas = 0
        for evidencia in fotos.iterator():
            if gerar_miniatura(evidencia):
                geradas += 1
            else:
                falhas += 1
        self.stdout.write(f"Miniaturas geradas: {geradas}. Sem miniatura: {falhas}.")
