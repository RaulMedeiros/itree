"""Importa os pontos de iluminação pública (SEINF, dados abertos da Prefeitura de Fortaleza).

    manage.py importar_iluminacao_publica                     # baixa o XLSX oficial
    manage.py importar_iluminacao_publica --arquivo rel.xlsx  # arquivo local

A fonte tem uma linha por lâmpada, em SIRGAS 2000 / UTM 24S (EPSG:31984). O comando agrega por
ponto de serviço, converte para WGS 84, descarta (e conta) o que não tem coordenada ou cai fora
do município e substitui todos os pontos de uma vez, de forma atômica.
"""

import time
from datetime import date
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.iluminacao import importacao


class Command(BaseCommand):
    help = "Importa os pontos de iluminação pública da fonte oficial (XLSX)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--arquivo", default=None, help="XLSX local no lugar do download da fonte oficial."
        )
        parser.add_argument("--url", default=importacao.URL_OFICIAL, help="Endereço do XLSX.")
        parser.add_argument(
            "--data-referencia",
            type=date.fromisoformat,
            default=importacao.DATA_REFERENCIA,
            help="Data do dado na fonte (padrão: a declarada no portal, 2022-11-16).",
        )

    def handle(self, *args, **opts):
        inicio = time.monotonic()
        baixado = None
        try:
            if opts["arquivo"]:
                caminho = Path(opts["arquivo"])
                if not caminho.is_file():
                    raise CommandError(f"Arquivo não encontrado: {caminho}")
            else:
                caminho = baixado = importacao.baixar(opts["url"])
            lote = importacao.importar(
                caminho, fonte_url=opts["url"], data_referencia=opts["data_referencia"]
            )
        except importacao.ErroPlanilha as exc:
            raise CommandError(str(exc)) from exc
        finally:
            if baixado:
                baixado.unlink(missing_ok=True)
        self.stdout.write(
            self.style.SUCCESS(
                f"Iluminação pública: {lote.linhas_lidas} linha(s) lida(s), "
                f"{lote.pontos_importados} ponto(s) importado(s) "
                f"em {time.monotonic() - inicio:.1f} s."
            )
        )
        descartes = [
            (lote.sem_coordenada, "sem coordenada"),
            (lote.coordenada_invalida, "com coordenada inválida"),
            (lote.fora_do_municipio, "fora do município"),
        ]
        if lote.sem_codigo:
            self.stdout.write(f"{lote.sem_codigo} linha(s) sem código descartada(s).")
        for quantidade, motivo in descartes:
            if quantidade:
                self.stdout.write(
                    self.style.WARNING(f"{quantidade} ponto(s) descartado(s) {motivo}.")
                )
