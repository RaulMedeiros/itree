"""Importa a população do Censo por bairro (IBGE), com domicílios e densidade. Idempotente.

    manage.py importar_populacao_censo                  # descobre o arquivo atual no FTP do IBGE
    manage.py importar_populacao_censo --arquivo x.zip  # ZIP ou CSV local (--ano se faltar)

Só entram os bairros já cadastrados cujo ``codigo`` é o código IBGE do bairro. Importe os limites
antes (``importar_limites_fortaleza``): a densidade usa a área do polígono oficial.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.indicadores import populacao as pop


class Command(BaseCommand):
    help = (
        "Importa a população residente do Censo por bairro, com a conferência contra o município."
    )

    def add_arguments(self, parser):
        parser.add_argument("--arquivo", help="ZIP ou CSV local, no lugar do download.")
        parser.add_argument("--arquivo-municipio", help="ZIP ou CSV 'por município' local.")
        parser.add_argument(
            "--url", help="Endereço do arquivo; padrão: o mais recente do diretório."
        )
        parser.add_argument(
            "--ano", type=int, help="Ano do Censo, se o caminho do arquivo não o traz."
        )

    def handle(self, *args, arquivo=None, arquivo_municipio=None, url=None, ano=None, **opts):
        try:
            if arquivo:
                conteudo = Path(arquivo).read_bytes()
                url = url or arquivo
            else:
                url = url or pop.descobrir_basico() or pop.URL_CENSO_BASICO
                conteudo = pop.baixar(url)
            total = None
            try:
                if arquivo_municipio:
                    total = pop.ler_total_municipio(Path(arquivo_municipio).read_bytes())
                elif not arquivo:
                    total = pop.ler_total_municipio(pop.baixar(pop.url_do_municipio(url)))
            except Exception as exc:  # noqa: BLE001
                self.stdout.write(self.style.WARNING(f"Sem o total municipal do Censo: {exc}"))
            versao = pop._versao_do_nome(url)
            ano = ano or pop.ano_do_censo(url)
            if ano is None:
                raise pop.FonteInvalida("O caminho do arquivo não traz o ano do Censo: use --ano.")
            r = pop.executar(
                pop.FONTE_CENSO_POPULACAO,
                "manual",
                versao,
                ano,
                lambda: pop.importar_populacao_censo(
                    conteudo, fonte_url=url, ano=ano, versao=versao, total_municipal=total
                ),
                propagar=True,
            )["resumo"]
        except Exception as exc:  # noqa: BLE001
            raise CommandError(f"Não foi possível importar: {exc}") from exc
        self.stdout.write(
            self.style.SUCCESS(
                f"{r['gravados']} bairro(s) gravado(s) (versão {versao or 'sem data'})."
            )
        )
        self.stdout.write(f"População somada dos bairros: {r['total_arquivo']:,}".replace(",", "."))
        if r["total_municipal"] is not None:
            self.stdout.write(
                f"População do município no Censo: {r['total_municipal']:,}; diferença: "
                f"{r['diferenca']:+,}".replace(",", ".")
            )
        if r["sem_casamento_no_arquivo"]:
            self.stdout.write(
                self.style.WARNING(
                    f"{len(r['sem_casamento_no_arquivo'])} linha(s) sem bairro cadastrado: "
                    + ", ".join(r["sem_casamento_no_arquivo"][:10])
                )
            )
        if r["bairros_sem_dado"]:
            self.stdout.write(
                self.style.WARNING(
                    f"{len(r['bairros_sem_dado'])} bairro(s) cadastrado(s) sem dado no Censo: "
                    + ", ".join(r["bairros_sem_dado"][:10])
                )
            )
