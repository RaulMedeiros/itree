"""Calcula a ilha de calor de superfície por bairro (UrbVerde, IAU-USP).

    manage.py importar_ilha_calor_urbverde                  # baixa o recorte pelo WCS
    manage.py importar_ilha_calor_urbverde --arquivo x.tif  # GeoTIFF local
    manage.py importar_ilha_calor_urbverde --bairros Aldeota Centro   # só lista estes

O valor do bairro é a média da diferença de temperatura de superfície (°C) para a mediana de
Fortaleza, em 2025, dos pixels de 30 m dentro do bairro (método em
``itree.indicadores.ilha_calor``).
Importe os bairros antes. Só **grava** com ``URBVERDE_GRAVAR_VALORES`` ligado: os Termos de Uso da
UrbVerde não são licença aberta. Desligado (padrão), calcula e mostra os valores sem gravar.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.indicadores import ilha_calor


class Command(BaseCommand):
    help = "Calcula (e, se permitido, grava) a ilha de calor de superfície por bairro."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo", help="GeoTIFF local, no lugar do download pelo WCS.")
        parser.add_argument("--url", default=ilha_calor.URL_WCS, help="Endereço do WCS.")
        parser.add_argument(
            "--bairros", nargs="*", default=[], help="Nomes a listar (todos, se vazio)."
        )

    def handle(self, *args, arquivo=None, url=ilha_calor.URL_WCS, bairros=(), **opts):
        try:
            if arquivo:
                conteudo = Path(arquivo).read_bytes()
            else:
                caixa = ilha_calor.caixa_dos_bairros()
                if caixa is None:
                    raise CommandError("Nenhum bairro cadastrado: importe os limites antes.")
                conteudo = ilha_calor.baixar(caixa, url)
            r = ilha_calor.importar(conteudo)
        except (OSError, ilha_calor.RasterInvalido) as exc:
            raise CommandError(f"Não foi possível obter ou ler o raster: {exc}") from exc
        escrever = self.stdout.write
        gravou = ilha_calor.gravar_permitido()
        escrever(
            self.style.SUCCESS(
                f"{len(r.medidas)} bairro(s) com medição; {len(r.sem_medicao)} sem pixel medido."
            )
        )
        if r.media_cidade is not None:
            escrever(f"  Média de Fortaleza (pixels medidos): {r.media_cidade:+.2f} °C")
        desejados = {b.lower() for b in bairros}
        for id_, medida in sorted(r.medidas.items(), key=lambda i: r.nomes[i[0]]):
            if desejados and r.nomes[id_].lower() not in desejados:
                continue
            escrever(
                f"  {r.nomes[id_]}: {medida.media:+.2f} °C "
                f"({medida.validos} de {medida.total} pixels medidos, "
                f"{100 * medida.cobertura:.0f}%)"
            )
        if gravou:
            escrever(self.style.SUCCESS(f"{r.gravados} valor(es) gravado(s)."))
        else:
            escrever(
                self.style.WARNING(
                    "Nada foi gravado: os Termos de Uso da UrbVerde não são licença aberta. "
                    "Com a autorização da USP, ligue URBVERDE_GRAVAR_VALORES."
                )
            )
