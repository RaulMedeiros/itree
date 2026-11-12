"""Importa os limites oficiais de Fortaleza (12 regionais e 121 bairros) do
Fortaleza em Mapas (Ipplan Fortaleza), via API de Dados Abertos.

    manage.py importar_limites_fortaleza

Reutiliza a lógica de ``importar_territorios``. É idempotente: reimportar
atualiza geometria e proveniência pelo código (regional: ``id`` da fonte;
bairro: "Código do IBGE"), sem duplicar. A hierarquia fica município > regional
> bairro, com a regional atual informada pela fonte.

A equivalência entre os códigos de regional do CKAN e do Fortaleza em Mapas está em
``itree.territorio.regionais``: cada regional grava o nome e o código do CKAN, e cada bairro
tem o código da região conferido contra a regional atual (e, se a regional atual faltar,
a regional sai desse código).

Para testar sem rede, use ``--arquivo-regionais`` e ``--arquivo-bairros`` com os
GeoJSON baixados da API.
"""

import json
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
from itree.territorio.regionais import (
    numero_da_regional,
    regional_por_codigo_ckan,
    regional_por_numero,
)

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
CAMPO_CODIGO_REGIAO = "Código da  Região"  # também com dois espaços
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
            fora_da_tabela = []
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
                equivalente = regional_por_numero(numero_da_regional(p["regiao_adm"]))
                if equivalente is None:
                    fora_da_tabela.append(str(p["regiao_adm"]))
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
                        # Equivalência com o CKAN (F-03): nome do polígono e código em romano.
                        "ckan_nome": equivalente.ckan_nome if equivalente else None,
                        "ckan_codigo": equivalente.codigo if equivalente else None,
                    },
                )
                importadas.append(territorio)
                if equivalente:
                    por_numero[equivalente.numero] = territorio
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
            recuperados = []
            divergentes = []
            for f in bairros["features"]:
                p = f["properties"]
                codigo = p.get(CAMPO_CODIGO_BAIRRO)
                if codigo in (None, ""):
                    raise CommandError(f"Bairro {p.get('Nome')!r} sem '{CAMPO_CODIGO_BAIRRO}'.")
                nome = str(p["Nome"]).strip()
                codigo_regiao = p.get(CAMPO_CODIGO_REGIAO)
                atual = regional_por_numero(numero_da_regional(p.get(CAMPO_REGIONAL_BAIRRO)))
                if atual is not None:
                    # O código da região da fonte precisa ser o da regional atual (F-03).
                    if codigo_regiao and atual.codigo != str(codigo_regiao).strip().upper():
                        divergentes.append(
                            f"{nome}: {atual.mapas_nome}, código da região {codigo_regiao}"
                        )
                    equivalente = atual
                else:
                    # Sem regional atual reconhecida: tenta pelo código da região.
                    equivalente = regional_por_codigo_ckan(codigo_regiao)
                    if equivalente is not None:
                        recuperados.append(nome)
                regional = por_numero.get(equivalente.numero) if equivalente else None
                if regional is None:
                    sem_regional.append(nome)
                territorio, criado = gravar_territorio(
                    TipoTerritorio.BAIRRO,
                    str(codigo),
                    nome,
                    _geometria(f),
                    comuns_bai,
                    {
                        "src_original": 31984,
                        "origem": origem_bai,
                        "mapa_id": ID_BAIRROS,
                        "ano_ref": p.get("ano_ref"),
                        "regional_atual": p.get(CAMPO_REGIONAL_BAIRRO),
                        "regional_antiga": p.get("Regional Antiga"),
                        "codigo_regiao_ckan": codigo_regiao,
                        "territorio": p.get("Território"),
                        "fonte_dado": p.get("Fonte"),
                    },
                    pai=regional or municipio,
                )
                contagem["bairro"][0 if criado else 1] += 1

        for tipo, (c, a) in contagem.items():
            self.stdout.write(f"{tipo}: {c} criado(s), {a} atualizado(s).")
        if fora_da_tabela:
            self.stdout.write(
                self.style.WARNING(
                    f"{len(fora_da_tabela)} regional(is) fora da tabela de equivalência "
                    f"(SER 1 a 12): {', '.join(fora_da_tabela)}."
                )
            )
        if recuperados:
            self.stdout.write(
                f"{len(recuperados)} bairro(s) ligados à regional pelo código da região "
                f"(sem regional atual reconhecida): {', '.join(recuperados)}."
            )
        if divergentes:
            self.stdout.write(
                self.style.WARNING(
                    f"{len(divergentes)} bairro(s) com código da região diferente do esperado "
                    f"para a regional atual (mantida a regional atual): {'; '.join(divergentes)}."
                )
            )
        if sem_regional:
            self.stdout.write(
                self.style.WARNING(
                    f"{len(sem_regional)} bairro(s) sem regional reconhecida, ligados ao "
                    f"município: {', '.join(sem_regional)}."
                )
            )
        self.stdout.write(self.style.SUCCESS(f"Limites de {opts['municipio']} importados."))
