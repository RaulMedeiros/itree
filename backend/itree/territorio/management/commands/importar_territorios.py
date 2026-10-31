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
from django.contrib.gis.geos import GEOSGeometry, MultiPolygon
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from itree.territorio.models import Territorio, TipoTerritorio

WGS84 = SpatialReference(4326)


def _multipoligono(geom: GEOSGeometry) -> MultiPolygon:
    if geom.geom_type == "Polygon":
        return MultiPolygon(geom, srid=geom.srid)
    if geom.geom_type == "MultiPolygon":
        return geom
    raise CommandError(f"Geometria {geom.geom_type} não é polígono.")


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
                if not geos.valid:
                    geos = geos.buffer(0)
                territorio, criado = Territorio.objects.update_or_create(
                    tipo=opts["tipo"],
                    codigo=str(feicao.get(opts["campo_codigo"])),
                    defaults={
                        **comuns,
                        "nome": str(feicao.get(opts["campo_nome"])).strip(),
                        "geom": _multipoligono(geos),
                        "metadados": {
                            "src_original": src_original,
                            "arquivo": str(opts["arquivo"]),
                        },
                    },
                )
                importados.append(territorio)
                criados += criado
                atualizados += not criado

            if opts["municipio"] and opts["tipo"] != TipoTerritorio.MUNICIPIO:
                municipio = self._municipio(opts["municipio"], importados, comuns, src_original)
                Territorio.objects.filter(pk__in=[t.pk for t in importados]).update(pai=municipio)

        self.stdout.write(self.style.SUCCESS(f"{criados} criado(s), {atualizados} atualizado(s)."))

    def _municipio(self, nome, importados, comuns, src_original) -> Territorio:
        existente = Territorio.objects.filter(tipo=TipoTerritorio.MUNICIPIO, nome=nome).first()
        if existente:
            return existente
        uniao = importados[0].geom
        for t in importados[1:]:
            uniao = uniao.union(t.geom)
        self.stdout.write(f"Município {nome} criado pela união de {len(importados)} territórios.")
        return Territorio.objects.create(
            tipo=TipoTerritorio.MUNICIPIO,
            codigo=nome.lower(),
            nome=nome,
            geom=_multipoligono(uniao),
            metadados={
                "src_original": src_original,
                "derivado": "união dos territórios importados",
            },
            **comuns,
        )
