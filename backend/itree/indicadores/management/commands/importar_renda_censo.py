"""Importa o rendimento médio do responsável pelo domicílio por bairro (Censo, IBGE). Idempotente.

manage.py importar_renda_censo                  # descobre o arquivo atual no FTP do IBGE
manage.py importar_renda_censo --arquivo x.zip  # ZIP ou CSV local
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.indicadores import populacao as pop


class Command(BaseCommand):
    help = "Importa o rendimento médio do responsável pelo domicílio, por bairro (Censo)."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo", help="ZIP ou CSV local, no lugar do download.")
        parser.add_argument(
            "--url", help="Endereço do arquivo; padrão: o mais recente do diretório."
        )
        parser.add_argument(
            "--ano", type=int, help="Ano do Censo, se o caminho do arquivo não o traz."
        )

    def handle(self, *args, arquivo=None, url=None, ano=None, **opts):
        try:
            if arquivo:
                conteudo = Path(arquivo).read_bytes()
                url = url or arquivo
            else:
                url = url or pop.descobrir_renda() or pop.URL_CENSO_RENDA
                conteudo = pop.baixar(url)
            versao = pop._versao_do_nome(url)
            ano = ano or pop.ano_do_censo(url)
            if ano is None:
                raise pop.FonteInvalida("O caminho do arquivo não traz o ano do Censo: use --ano.")
            r = pop.executar(
                pop.FONTE_CENSO_RENDA,
                "manual",
                versao,
                ano,
                lambda: pop.importar_renda(conteudo, fonte_url=url, ano=ano, versao=versao),
                propagar=True,
            )["resumo"]
        except Exception as exc:  # noqa: BLE001
            raise CommandError(f"Não foi possível importar: {exc}") from exc
        self.stdout.write(
            self.style.SUCCESS(
                f"{r['gravados']} bairro(s) gravado(s) (versão {versao or 'sem data'})."
            )
        )
        if r["sem_casamento_no_arquivo"]:
            self.stdout.write(
                self.style.WARNING(
                    "Linhas sem bairro cadastrado: " + ", ".join(r["sem_casamento_no_arquivo"][:10])
                )
            )
        if r["bairros_sem_dado"]:
            self.stdout.write(
                self.style.WARNING(
                    f"{len(r['bairros_sem_dado'])} bairro(s) sem valor: "
                    + ", ".join(r["bairros_sem_dado"][:10])
                )
            )
