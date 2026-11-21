"""Confere as fontes de população, renda e IDH e reimporta o que mudou (tarefa mensal)."""

from django.core.management.base import BaseCommand

from itree.indicadores import populacao as pop


class Command(BaseCommand):
    help = "Confere e renova população do Censo, rendimento, estimativa anual e IDH por bairro."

    def handle(self, *args, **opts):
        for r in pop.renovar(origem="manual"):
            texto = f"{pop.FONTES[r['fonte']]}: {r['situacao']} {r.get('versao', '')} " + r.get(
                "erro", ""
            )
            self.stdout.write(self.style.ERROR(texto) if r["situacao"] == "falha" else texto)
