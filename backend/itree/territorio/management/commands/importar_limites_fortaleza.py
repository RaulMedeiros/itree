"""Importa os limites oficiais de Fortaleza (12 regionais e 121 bairros) do
Fortaleza em Mapas (Ipplan Fortaleza), via API de Dados Abertos.

    manage.py importar_limites_fortaleza

Reutiliza a lógica de ``importar_territorios``. É idempotente: reimportar
atualiza geometria e proveniência pelo código (regional: ``id`` da fonte;
bairro: "Código do IBGE"), sem duplicar. A hierarquia fica município > regional
> bairro, com a regional atual informada pela fonte.

Para testar sem rede, use ``--arquivo-regionais`` e ``--arquivo-bairros`` com os
GeoJSON baixados da API.
"""

import json
import re
from datetime import date
from pathlib import Path

import pghistory
import requests
from django.conf import settings
from django.contrib.gis.geos import GEOSGeometry
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from itree.territorio.importacao import (
    geometria_valida,
    gravar_territorio,
    obter_ou_criar_municipio,
)
from itree.territorio.models import Territorio, TipoTerritorio

API_GEOJSON = "https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id="
ID_REGIONAIS = 17
ID_BAIRROS = 21
FONTE = (
    "Prefeitura Municipal de Fortaleza - Fortaleza em Mapas (Ipplan Fortaleza). "
    "Acesso via API de Dados Abertos."
)
LICENCA = "Uso livre com citação da fonte (termos da API)"
PAGINAS = {
    ID_REGIONAIS: "https://mapas.fortaleza.ce.gov.br/mapa/17/secretarias-executivas-regionais",
    ID_BAIRROS: "https://mapas.fortaleza.ce.gov.br/mapa/21/bairros-de-fortaleza",
}
# O nome real do campo na fonte tem dois espaços.
CAMPO_CODIGO_BAIRRO = "Código do  IBGE"
CAMPO_REGIONAL_BAIRRO = "Regional Atual"
ESPERADOS = {ID_REGIONAIS: 12, ID_BAIRROS: 121}


def _carregar(arquivo: str | None, mapa_id: int) -> tuple[dict, str]:
    """Lê o GeoJSON do arquivo local ou da API. Devolve (dados, origem)."""
    if arquivo:
        try:
            dados = json.loads(Path(arquivo).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise CommandError(f"Não foi possível ler {arquivo}: {exc}") from exc
        origem = str(arquivo)
    else:
        origem = f"{API_GEOJSON}{mapa_id}"
        try:
            resposta = requests.get(origem, timeout=getattr(settings, "ALERTAS_TIMEOUT", 60))
            resposta.raise_for_status()
            dados = resposta.json()
        except (requests.RequestException, ValueError) as exc:
            raise CommandError(f"Falha ao obter {origem}: {exc}") from exc
    if not isinstance(dados, dict) or not isinstance(dados.get("features"), list):
        raise CommandError(f"{origem}: esperada uma FeatureCollection.")
    crs = ((dados.get("crs") or {}).get("properties") or {}).get("name", "")
    if crs and "4326" not in crs and "CRS84" not in crs:
        raise CommandError(f"{origem}: SRC {crs} não suportado (esperado EPSG:4326).")
    return dados, origem


def _geometria(feicao: dict) -> GEOSGeometry:
    try:
        geom = GEOSGeometry(json.dumps(feicao["geometry"]), srid=4326)
    except Exception as exc:  # noqa: BLE001 - geometria ausente ou inválida
        raise CommandError(f"Feição {feicao.get('id')} sem geometria válida: {exc}") from exc
    return geometria_valida(geom)


def _data(texto) -> date | None:
    """A fonte informa ``2022-11-13Z``."""
    try:
        return date.fromisoformat(str(texto)[:10])
    except ValueError:
        return None


def _numero_regional(texto) -> str | None:
    """'Secretaria Executiva Regional 8' ou 'SER 8' -> '8'."""
    achado = re.search(r"(\d+)\s*$", str(texto or ""))
    return achado.group(1) if achado else None


class Command(BaseCommand):
    help = "Importa as regionais e os bairros oficiais de Fortaleza (Fortaleza em Mapas)."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo-regionais", help="GeoJSON local no lugar da API (id 17).")
        parser.add_argument("--arquivo-bairros", help="GeoJSON local no lugar da API (id 21).")
        parser.add_argument("--municipio", default="Fortaleza")
        parser.add_argument(
            "--permitir-contagem-diferente",
            action="store_true",
            help="Aceita arquivos com outra quantidade de feições (12 regionais, 121 bairros).",
        )

    def _conferir_contagem(self, dados, mapa_id, origem, permitir):
        esperado, lidas = ESPERADOS[mapa_id], len(dados["features"])
        if lidas != esperado and not permitir:
            raise CommandError(
                f"{origem}: {lidas} feições, esperadas {esperado}. "
                "Use --permitir-contagem-diferente se for intencional."
            )

    @transaction.atomic
    def handle(self, *args, **opts):
        regionais, origem_reg = _carregar(opts["arquivo_regionais"], ID_REGIONAIS)
        bairros, origem_bai = _carregar(opts["arquivo_bairros"], ID_BAIRROS)
        permitir = opts["permitir_contagem_diferente"]
        self._conferir_contagem(regionais, ID_REGIONAIS, origem_reg, permitir)
        self._conferir_contagem(bairros, ID_BAIRROS, origem_bai, permitir)

        agora = timezone.now()

        def comuns(mapa_id, data_ref):
            return {
                "fonte": FONTE,
                "fonte_url": PAGINAS[mapa_id],
                "licenca": LICENCA,
                "data_referencia": data_ref,
                "ingerido_em": agora,
            }

        contagem = {"regional": [0, 0], "bairro": [0, 0]}
        with pghistory.context(evento="importacao_limites_fortaleza"):
            # Regionais: a fonte só informa o ano de referência (ano_ref).
            importadas = []
            por_numero = {}
            anos = [
                f["properties"].get("ano_ref")
                for f in regionais["features"]
                if f["properties"].get("ano_ref")
            ]
            data_reg = date(int(max(anos)), 1, 1) if anos else None
            comuns_reg = comuns(ID_REGIONAIS, data_reg)
            for f in regionais["features"]:
                p = f["properties"]
                geom = _geometria(f)
                territorio, criado = gravar_territorio(
                    TipoTerritorio.REGIONAL,
                    str(p["id"]),
                    str(p["regiao_adm"]).strip(),
                    geom,
                    comuns_reg,
                    {
                        "src_original": 31984,
                        "origem": origem_reg,
                        "mapa_id": ID_REGIONAIS,
                        "ano_ref": p.get("ano_ref"),
                        "data_referencia_precisao": "ano",
                        "fonte_dado": p.get("fonte"),
                    },
                )
                importadas.append(territorio)
                por_numero[_numero_regional(p["regiao_adm"])] = territorio
                contagem["regional"][0 if criado else 1] += 1

            municipio = obter_ou_criar_municipio(
                opts["municipio"], importadas, comuns_reg, 31984, self.stdout.write
            )
            Territorio.objects.filter(pk__in=[t.pk for t in importadas]).update(pai=municipio)

            # Bairros: a data de referência vem do campo "data" de cada feição.
            datas = [_data(f["properties"].get("data")) for f in bairros["features"]]
            data_bai = max((d for d in datas if d), default=None)
            comuns_bai = comuns(ID_BAIRROS, data_bai)
            sem_regional = []
            for f in bairros["features"]:
                p = f["properties"]
                codigo = p.get(CAMPO_CODIGO_BAIRRO)
                if codigo in (None, ""):
                    raise CommandError(f"Bairro {p.get('Nome')!r} sem '{CAMPO_CODIGO_BAIRRO}'.")
                regional = por_numero.get(_numero_regional(p.get(CAMPO_REGIONAL_BAIRRO)))
                if regional is None:
                    sem_regional.append(str(p.get("Nome")))
                territorio, criado = gravar_territorio(
                    TipoTerritorio.BAIRRO,
                    str(codigo),
                    str(p["Nome"]).strip(),
                    _geometria(f),
                    comuns_bai,
                    {
                        "src_original": 31984,
                        "origem": origem_bai,
                        "mapa_id": ID_BAIRROS,
                        "ano_ref": p.get("ano_ref"),
                        "regional_atual": p.get(CAMPO_REGIONAL_BAIRRO),
                        "regional_antiga": p.get("Regional Antiga"),
                        "territorio": p.get("Território"),
                        "fonte_dado": p.get("Fonte"),
                    },
                    pai=regional or municipio,
                )
                contagem["bairro"][0 if criado else 1] += 1

        for tipo, (c, a) in contagem.items():
            self.stdout.write(f"{tipo}: {c} criado(s), {a} atualizado(s).")
        if sem_regional:
            self.stdout.write(
                self.style.WARNING(
                    f"{len(sem_regional)} bairro(s) sem regional reconhecida, ligados ao "
                    f"município: {', '.join(sem_regional)}."
                )
            )
        self.stdout.write(self.style.SUCCESS(f"Limites de {opts['municipio']} importados."))
