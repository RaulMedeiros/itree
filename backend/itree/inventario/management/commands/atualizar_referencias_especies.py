import time

import pghistory
from django.core.management.base import BaseCommand

from itree.inventario import referencias
from itree.inventario.models import Especie, SituacaoReferencias


class Command(BaseCommand):
    help = (
        "Consulta Wikidata, Wikipedia e Wikimedia Commons para as espécies do catálogo. "
        "Por padrão, só as ainda não consultadas ou com erro."
    )

    def add_arguments(self, parser):
        parser.add_argument("--todas", action="store_true", help="Consulta todas as espécies.")
        parser.add_argument("--nome", help="Só a espécie com este nome científico.")
        parser.add_argument(
            "--intervalo", type=float, default=1.0, help="Segundos entre consultas (padrão 1)."
        )

    def handle(self, *args, **opcoes):
        qs = Especie.objects.filter(ativa=True)
        if opcoes["nome"]:
            qs = qs.filter(nome_cientifico__iexact=opcoes["nome"])
        elif not opcoes["todas"]:
            qs = qs.filter(
                referencias_situacao__in=[
                    SituacaoReferencias.NAO_CONSULTADA,
                    SituacaoReferencias.ERRO,
                ]
            )
        for i, especie in enumerate(qs):
            if i:
                time.sleep(opcoes["intervalo"])  # cortesia com as APIs públicas
            with pghistory.context(evento="referencias_especie"):
                especie = referencias.atualizar(especie)
            self.stdout.write(
                f"{especie.nome_cientifico}: {especie.get_referencias_situacao_display()}"
                + (f" — {especie.referencias_mensagem}" if especie.referencias_mensagem else "")
            )
