"""Importa limites territoriais de GeoJSON, Shapefile ou outro formato lido pelo
GDAL. Idempotente: reimportar atualiza os registros por (tipo, código).

Exemplo (bairros de Fortaleza):

    manage.py importar_territorios bairros.geojson --tipo bairro \\
        --campo-nome Nome --campo-codigo Codigo \\
        --fonte "Fortaleza Dados Abertos" --fonte-url https://dados.fortaleza.ce.gov.br/... \\
        --data-referencia 2024-01-01 --municipio Fortaleza
"""

from datetime import date

import pghistory
from django.contrib.gis.gdal import CoordTransform, DataSource, SpatialReference
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from itree.territorio.importacao import (
    geometria_valida,
    gravar_territorio,
    obter_ou_criar_municipio,
)
from itree.territorio.models import Territorio, TipoTerritorio

WGS84 = SpatialReference(4326)


class Command(BaseCommand):
    help = "Importa territórios (município, regionais, bairros) mantendo fonte e data."

    def add_arguments(self, parser):
        parser.add_argument("arquivo", help="Caminho ou URL (/vsicurl/...) do arquivo.")
        parser.add_argument("--tipo", required=True, choices=TipoTerritorio.values)
        parser.add_argument("--campo-nome", required=True)
        parser.add_argument("--campo-codigo", required=True)
        parser.add_argument("--fonte", required=True)
        parser.add_argument("--fonte-url", default="")
        parser.add_argument("--licenca", default="")
        parser.add_argument("--data-referencia", type=date.fromisoformat, default=None)
        parser.add_argument(
            "--src-padrao",
            type=int,
            default=None,
            help="EPSG a assumir se o arquivo não declarar SRC.",
        )
        parser.add_argument(
            "--municipio",
            default=None,
            help="Nome do município: vincula os territórios a ele, criando-o pela "
            "união das geometrias se ainda não existir.",
        )
        parser.add_argument("--camada", type=int, default=0)

    @transaction.atomic
    def handle(self, *args, **opts):
        try:
            fonte_dados = DataSource(opts["arquivo"])
        except Exception as exc:  # noqa: BLE001
            raise CommandError(f"Não foi possível abrir {opts['arquivo']}: {exc}") from exc
        camada = fonte_dados[opts["camada"]]

        src = camada.srs
        if src is None:
            if not opts["src_padrao"]:
                raise CommandError("O arquivo não declara SRC; informe --src-padrao.")
            src = SpatialReference(opts["src_padrao"])
        src_original = src.srid or src.wkt
        transformacao = CoordTransform(src, WGS84)

        agora = timezone.now()
        comuns = {
            "fonte": opts["fonte"],
            "fonte_url": opts["fonte_url"],
            "licenca": opts["licenca"],
            "data_referencia": opts["data_referencia"],
            "ingerido_em": agora,
        }

        criados = atualizados = 0
        with pghistory.context(evento="importacao_territorios", arquivo=str(opts["arquivo"])):
            importados = []
            for feicao in camada:
                geom = feicao.geom
                geom.transform(transformacao)
                geos = geom.geos
                geos.srid = 4326
                geos = geometria_valida(geos)
                territorio, criado = gravar_territorio(
                    opts["tipo"],
                    str(feicao.get(opts["campo_codigo"])),
                    str(feicao.get(opts["campo_nome"])).strip(),
                    geos,
                    comuns,
                    {"src_original": src_original, "arquivo": str(opts["arquivo"])},
                )
                importados.append(territorio)
                criados += criado
                atualizados += not criado

            if opts["municipio"] and opts["tipo"] != TipoTerritorio.MUNICIPIO:
                municipio = obter_ou_criar_municipio(
                    opts["municipio"], importados, comuns, src_original, self.stdout.write
                )
                Territorio.objects.filter(pk__in=[t.pk for t in importados]).update(pai=municipio)

        self.stdout.write(self.style.SUCCESS(f"{criados} criado(s), {atualizados} atualizado(s)."))
