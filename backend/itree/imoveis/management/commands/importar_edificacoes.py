"""Importa os contornos de edificações de Fortaleza (Google Open Buildings v3, CC BY 4.0).

    manage.py importar_edificacoes                       # baixa a célula S2 07c7 e importa
    manage.py importar_edificacoes --arquivo celula.csv.gz
    manage.py importar_edificacoes --confianca-minima 0.7

Recorta pelo limite municipal e troca todas as edificações da mesma fonte (idempotente). O arquivo
baixado fica num diretório temporário e é apagado no fim. Confira o disco antes (`df -h /`): a
célula tem cerca de 100 MB compactada.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.imoveis import edificacoes


class Command(BaseCommand):
    help = "Importa as edificações de Fortaleza (Google Open Buildings v3)."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo", help="CSV (.csv ou .csv.gz) local, no lugar do download.")
        parser.add_argument("--confianca-minima", type=float, default=0.0)
        parser.add_argument(
            "--calcular",
            action="store_true",
            help="Recalcula a regra 3-30-300 depois da importação.",
        )

    def handle(self, *args, arquivo=None, confianca_minima=0.0, calcular=False, **opts):
        try:
            if arquivo:
                r = edificacoes.importar(Path(arquivo), confianca_minima=confianca_minima)
            else:
                r = edificacoes.importar_da_rede(confianca_minima=confianca_minima)
        except (edificacoes.ArquivoInvalido, OSError) as exc:
            raise CommandError(f"Não foi possível importar: {exc}") from exc
        leitura = r.leitura
        self.stdout.write(
            self.style.SUCCESS(
                f"{r.importadas} edificação(ões) importada(s) em {r.duracao_s:.0f} s "
                f"({leitura.linhas_lidas} linhas lidas, {leitura.fora_do_municipio} fora do "
                f"município, {leitura.invalidas} inválidas, {r.geometria_invalida} com geometria "
                f"inválida, {leitura.abaixo_da_confianca} abaixo da confiança, "
                f"{r.sem_bairro} sem bairro)."
            )
        )
        if calcular:
            from django.core.management import call_command

            call_command("calcular_3_30_300")
