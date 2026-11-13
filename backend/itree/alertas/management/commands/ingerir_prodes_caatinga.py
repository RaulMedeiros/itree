"""Ingere o PRODES Caatinga (supressão anual de vegetação, INPE) como camada de referência.

    manage.py ingerir_prodes_caatinga
    manage.py ingerir_prodes_caatinga --buffer-km 5
    manage.py ingerir_prodes_caatinga --arquivo prodes.geojson

Baixa do WFS do TerraBrasilis só o retângulo do município ampliado pelo buffer e guarda os
polígonos que intersectam o município ampliado. **Não cria alerta nem pendência de triagem**:
é contexto histórico, anual e de escala regional (polígonos de cerca de 1 ha ou mais).
Exige o município cadastrado (``importar_limites_fortaleza``).
"""

from django.core.management.base import BaseCommand, CommandError

from itree.alertas import prodes
from itree.alertas.fontes import ErroFonte
from itree.alertas.models import SupressaoAnual


class Command(BaseCommand):
    help = "Ingere o PRODES Caatinga (supressão anual) como camada de referência, sem alertas."

    def add_arguments(self, parser):
        parser.add_argument(
            "--buffer-km",
            type=float,
            default=None,
            help="Buffer (km) ao redor do município (padrão: PRODES_CAATINGA_BUFFER_KM).",
        )
        parser.add_argument(
            "--arquivo", help="GeoJSON já baixado do WFS; sem ele, baixa do TerraBrasilis."
        )

    def handle(self, *args, buffer_km, arquivo, **opts):
        try:
            area = prodes.recorte(buffer_km)
            if arquivo:
                with open(arquivo, "rb") as f:
                    conteudo = f.read()
                origem = arquivo
            else:
                origem = prodes.url_do_recorte(area)
                conteudo = prodes.baixar(origem)
            resumo = prodes.ingerir(conteudo, area, origem)
        except (ErroFonte, OSError) as exc:
            raise CommandError(str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 - rede e formato da fonte
            raise CommandError(
                f"Falha ao ingerir o PRODES: {exc.__class__.__name__}: {exc}"
            ) from exc
        self.stdout.write(
            self.style.SUCCESS(
                f"PRODES Caatinga: {resumo.recebidos} polígonos recebidos, "
                f"{resumo.novos} novos, {resumo.atualizados} atualizados, "
                f"{resumo.fora_do_recorte} fora do recorte, {resumo.invalidos} inválidos. "
                f"Total na camada: {SupressaoAnual.objects.count()}. Nenhum alerta foi criado."
            )
        )
