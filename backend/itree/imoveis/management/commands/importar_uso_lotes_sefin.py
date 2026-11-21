"""Colhe o uso predominante por lote (SEFIN, 2022) do WMS do Fortaleza em Mapas e classifica as
edificações (residencial, não residencial, misto ou territorial) pelo lote que contém o centro.

    manage.py importar_uso_lotes_sefin                   # as 12 regionais (demorado)
    manage.py importar_uso_lotes_sefin --regional 2 --regional 12
    manage.py importar_uso_lotes_sefin --so-classificar  # reaproveita os lotes já colhidos

A colheita é sequencial e respeita o servidor (pausa entre consultas). Cada regional é gravada ao
terminar, e uma nova execução reaproveita os lotes já gravados.
"""

from django.core.management.base import BaseCommand, CommandError

from itree.imoveis import uso_lotes


class Command(BaseCommand):
    help = "Colhe o uso por lote (SEFIN 2022, WMS) e classifica as edificações."

    def add_arguments(self, parser):
        parser.add_argument("--regional", type=int, action="append", help="Número da SER (1 a 12).")
        parser.add_argument("--max-requisicoes", type=int, help="Limite por regional (teste).")
        parser.add_argument("--so-classificar", action="store_true")
        parser.add_argument("--calcular", action="store_true")

    def handle(
        self,
        *args,
        regional=None,
        max_requisicoes=None,
        so_classificar=False,
        calcular=False,
        **opts,
    ):
        if not so_classificar:
            geometrias = uso_lotes.regionais_geometrias()
            if not geometrias:
                raise CommandError("Importe os limites (importar_limites_fortaleza) antes.")
            alvos = regional or sorted(geometrias)
            for numero in alvos:
                if numero not in geometrias:
                    raise CommandError(f"SER {numero} não cadastrada.")
                c = uso_lotes.colher_regional(
                    numero,
                    geometrias[numero],
                    max_requisicoes=max_requisicoes,
                    saida=lambda t: self.stdout.write(t),
                )
                self.stdout.write(
                    f"SER {numero}: {c.requisicoes} consultas, {c.lotes} lotes novos, "
                    f"{c.truncadas} divididas, {c.descartados} descartados, {len(c.falhas)} falhas."
                )
                for falha in c.falhas[:5]:
                    self.stdout.write(self.style.WARNING(falha))
        r = uso_lotes.classificar_edificacoes()
        cobertura = (
            f"{100 * r['cobertura']:.1f}%" if r["cobertura"] is not None else "sem edificações"
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"{r['classificadas']} de {r['edificacoes']} edificações classificadas "
                f"({cobertura}): {r['por_uso']}."
            )
        )
        if calcular:
            from django.core.management import call_command

            call_command("calcular_3_30_300")
