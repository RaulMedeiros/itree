"""Importa a estimativa anual da população de Fortaleza (IBGE) e recalcula a estimativa por bairro.

    manage.py importar_estimativa_populacao                  # ano mais recente, versão mais recente
    manage.py importar_estimativa_populacao --arquivo x.xlsx

A estimativa por bairro é do iTree (Censo × razão municipal), nunca dado oficial. Precisa da
população do Censo importada (``importar_populacao_censo``) para o cálculo por bairro.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.indicadores import populacao as pop


class Command(BaseCommand):
    help = "Importa a estimativa municipal da população (IBGE) e a estimativa iTree por bairro."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo", help="Planilha XLSX local, no lugar do download.")
        parser.add_argument("--url", help="Endereço do arquivo; padrão: o mais recente do FTP.")

    def handle(self, *args, arquivo=None, url=None, **opts):
        try:
            if arquivo:
                conteudo = Path(arquivo).read_bytes()
                url = url or arquivo
            else:
                url = url or pop.descobrir_estimativa()
                if not url:
                    raise pop.FonteInvalida("Nenhuma estimativa encontrada no FTP.")
                conteudo = pop.baixar(url)
            versao = pop._versao_do_nome(url)
            resultado = pop.importar_estimativa(conteudo, fonte_url=url, versao=versao)
            pop.registrar_execucao(
                pop.FONTE_ESTIMATIVA,
                sucesso=True,
                importou=True,
                versao=versao,
                ano_referencia=resultado.ano,
                resumo={"populacao_municipio": resultado.populacao, "bairros": resultado.bairros},
            )
        except Exception as exc:  # noqa: BLE001
            pop.registrar_execucao(pop.FONTE_ESTIMATIVA, sucesso=False, erro=str(exc)[:1000])
            raise CommandError(f"Não foi possível importar: {exc}") from exc
        self.stdout.write(
            self.style.SUCCESS(
                f"Estimativa de {resultado.ano} (1º/7): {resultado.populacao:,} pessoas, versão "
                f"{versao or 'sem data'}.".replace(",", ".")
            )
        )
        if resultado.bairros:
            self.stdout.write(f"{resultado.bairros} bairro(s) com estimativa iTree.")
        else:
            self.stdout.write(
                self.style.WARNING(
                    "Sem estimativa por bairro: importe a população do Censo (e o total municipal)."
                )
            )
