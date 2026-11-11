"""Importa praças, parques urbanos e unidades de conservação do Fortaleza em Mapas.

A API pública (sem token) entrega GeoJSON por mapa: praças (id 99, URBFOR),
parques urbanos municipais (id 86, SEUMA) e unidades de conservação (id 737,
SEUMA e CEUC/SEMA). Idempotente: reimportar atualiza por (tipo, código externo),
com o nome como chave só quando a fonte não traz código.

    manage.py importar_areas_verdes                 # as três camadas, pela API
    manage.py importar_areas_verdes --tipo praca    # só as praças
    manage.py importar_areas_verdes --tipo parque --arquivo parques.geojson

Não importa nenhum campo de pessoa (o mapa 622, "Adoção de Praças", traz o
nome do adotante, que é dado pessoal e fica de fora).
"""

import json
import re
from datetime import date

import pghistory
import requests
from django.contrib.gis.gdal import CoordTransform, SpatialReference
from django.contrib.gis.geos import GEOSGeometry, MultiPolygon, WKBWriter
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from itree.areas_verdes.models import AreaVerde, TipoAreaVerde

API = "https://mapas.fortaleza.ce.gov.br"
LICENCA = (
    "Termos da API do Fortaleza em Mapas: uso livre, com citação obrigatória da fonte "
    "(Prefeitura Municipal de Fortaleza - Fortaleza em Mapas, Ipplan Fortaleza)."
)
TIMEOUT_S = 60
PALAVRAS_MIUDAS = {"da", "das", "de", "do", "dos", "e"}
SRC_API = 4326  # a API declara EPSG:4326 (o original, SIRGAS 2000 UTM 24S, vem em epsg_codif)


def _texto(valor) -> str:
    return " ".join(str(valor).split()) if valor not in (None, "") else ""


def area_em_m2(valor) -> float | None:
    """Área da fonte para m². Aceita número ou texto brasileiro ("57.052,50m²")."""
    if isinstance(valor, int | float):
        return float(valor)
    bruto = re.sub(r"[^\d.,]", "", _texto(valor))
    if not bruto:
        return None
    if "," in bruto:
        bruto = bruto.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+", bruto):
        bruto = bruto.replace(".", "")
    try:
        return float(bruto)
    except ValueError:
        return None


def nome_legivel(nome: str) -> str:
    """ "PARQUE URBANO DA LAGOA" vira "Parque Urbano da Lagoa"; nomes mistos ficam como estão."""
    nome = _texto(nome)
    if not nome.isupper():
        return nome
    palavras = [p.lower() for p in nome.split()]
    return " ".join(
        p
        if (i and p in PALAVRAS_MIUDAS)
        else re.sub(r"[^\W\d_]", lambda m: m[0].upper(), p, count=1)
        for i, p in enumerate(palavras)
    )


def _ano(valor) -> int | None:
    try:
        return int(str(valor).strip())
    except (TypeError, ValueError):
        return None


def _src_original(props: dict) -> str:
    """SRC original informado pela fonte, p.ex. "EPSG: 31984 (SIRGAS 2000 - UTM 24S)"."""
    return _texto(str(props.get("epsg_codif", "")).split(";")[0])


def _base(props: dict) -> dict:
    return {
        "metadados": {
            "ano_referencia": _ano(props.get("anoref") or props.get("ano_ref")),
            "src_original": _src_original(props),
        }
    }


def _praca(props: dict) -> dict:
    popular = _texto(props.get("nome_pop"))
    base = _base(props)
    base["metadados"].update(
        bairro=_texto(props.get("bairro")), codigo_bairro=props.get("cod_bairro")
    )
    return {
        "nome": _texto(props.get("nome")),
        "nome_popular": "" if popular.lower() == "sem informação" else popular,
        "codigo_externo": _texto(props.get("id")),
        "orgao_gestor": _texto(props.get("fonte")),
        "esfera": "Municipal",
        "ato_legal": "",
        "area_m2": area_em_m2(props.get("area m2")),
        **base,
    }


def _parque(props: dict) -> dict:
    original = _texto(props.get("Nome"))
    base = _base(props)
    base["metadados"]["nome_original"] = original
    return {
        "nome": nome_legivel(original),
        "nome_popular": "",
        "codigo_externo": _texto(props.get("id")),
        "orgao_gestor": _texto(props.get("Fonte")),
        "esfera": "Municipal",
        "ato_legal": _texto(props.get("Decreto")),
        "area_m2": area_em_m2(props.get("Área (m²)")),
        **base,
    }


def _unidade(props: dict) -> dict:
    base = _base(props)
    base["metadados"].update(
        categoria=_texto(props.get("Tipo")),
        municipios=_texto(props.get("Municípios")),
        observacoes=_texto(props.get("Observações")).strip("-"),
    )
    return {
        "nome": _texto(props.get("Nome")),
        "nome_popular": "",
        "codigo_externo": _texto(props.get("id")),
        "orgao_gestor": _texto(props.get("Fonte")),
        "esfera": _texto(props.get("Esfera")),
        "ato_legal": _texto(props.get("Decreto/Lei")),
        "area_m2": area_em_m2(props.get("Área  (m²)")),
        **base,
    }


# Mapa do Fortaleza em Mapas de cada tipo, com o nome e o órgão que a fonte declara.
CAMADAS = {
    TipoAreaVerde.PRACA: {
        "mapa": 99,
        "fonte": "Fortaleza em Mapas (Ipplan Fortaleza): Praças de Fortaleza, URBFOR",
        "campos": _praca,
    },
    TipoAreaVerde.PARQUE: {
        "mapa": 86,
        "fonte": "Fortaleza em Mapas (Ipplan Fortaleza): Parques Urbanos Municipais, SEUMA",
        "campos": _parque,
    },
    TipoAreaVerde.UNIDADE_CONSERVACAO: {
        "mapa": 737,
        "fonte": (
            "Fortaleza em Mapas (Ipplan Fortaleza): Unidades de Conservação, SEUMA e CEUC/SEMA"
        ),
        "campos": _unidade,
    },
}


def url_do_mapa(mapa: int, base: str = API) -> str:
    return f"{base.rstrip('/')}/api/v1/geojson?id={mapa}"


def _srid_declarado(dados: dict) -> int:
    """EPSG declarado no GeoJSON ("urn:ogc:def:crs:EPSG::4326"); 4326 quando não há."""
    nome = ((dados.get("crs") or {}).get("properties") or {}).get("name", "")
    achado = re.search(r"EPSG:+(\d+)", nome)
    return int(achado.group(1)) if achado else SRC_API


def _multipoligono(geometria: dict, srid: int) -> MultiPolygon:
    geos = GEOSGeometry(json.dumps(geometria))  # o GDAL assume 4326; o SRC real vem abaixo
    if geos.hasz:  # as unidades de conservação vêm com Z (a coluna é 2D)
        geos = GEOSGeometry(WKBWriter(dim=2).write(geos))
    geos.srid = srid
    if srid != 4326:
        geos.transform(CoordTransform(SpatialReference(srid), SpatialReference(4326)))
    if not geos.valid:
        geos = geos.buffer(0)
    if geos.geom_type == "Polygon":
        return MultiPolygon(geos, srid=4326)
    if geos.geom_type == "MultiPolygon":
        return geos
    raise CommandError(f"Geometria {geos.geom_type} não é polígono.")


def ler_feicoes(arquivo: str | None, mapa: int, base: str) -> dict:
    """GeoJSON do arquivo local ou da API; trata como dado não confiável (só lê JSON)."""
    if arquivo:
        try:
            with open(arquivo, encoding="utf-8") as f:
                dados = json.load(f)
        except (OSError, ValueError) as exc:
            raise CommandError(f"Não foi possível ler {arquivo}: {exc}") from exc
    else:
        url = url_do_mapa(mapa, base)
        try:
            resposta = requests.get(url, timeout=TIMEOUT_S, headers={"User-Agent": "iTree"})
            resposta.raise_for_status()
            dados = resposta.json()
        except (requests.RequestException, ValueError) as exc:
            raise CommandError(f"Falha ao obter {url}: {exc}") from exc
    if not isinstance(dados, dict) or not isinstance(dados.get("features"), list):
        raise CommandError("A fonte não devolveu uma FeatureCollection GeoJSON.")
    return dados


class Command(BaseCommand):
    help = "Importa praças, parques urbanos e unidades de conservação (Fortaleza em Mapas)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--tipo",
            choices=[*TipoAreaVerde.values, "todos"],
            default="todos",
            help="Tipo a importar (padrão: todos, pela API).",
        )
        parser.add_argument(
            "--arquivo",
            default=None,
            help="GeoJSON local no lugar da API; exige --tipo. Usado em testes.",
        )
        parser.add_argument("--api", default=API, help="Endereço base da API (padrão: oficial).")
        parser.add_argument(
            "--data-referencia",
            type=date.fromisoformat,
            default=None,
            help="Data do dado; sem ela vale 1º de janeiro do ano informado pela fonte.",
        )

    @transaction.atomic
    def handle(self, *args, **opts):
        if opts["arquivo"] and opts["tipo"] == "todos":
            raise CommandError("--arquivo exige --tipo, porque cada arquivo é de um tipo.")
        tipos = list(CAMADAS) if opts["tipo"] == "todos" else [opts["tipo"]]
        agora = timezone.now()
        with pghistory.context(evento="importacao_areas_verdes", arquivo=str(opts["arquivo"])):
            for tipo in tipos:
                self._importar(tipo, opts, agora)

    def _importar(self, tipo, opts, agora) -> None:
        camada = CAMADAS[tipo]
        dados = ler_feicoes(opts["arquivo"], camada["mapa"], opts["api"])
        srid = _srid_declarado(dados)
        fonte_url = url_do_mapa(camada["mapa"], opts["api"])
        criados = atualizados = ignorados = 0
        for feicao in dados["features"]:
            props = feicao.get("properties") or {}
            campos = camada["campos"](props)
            if not feicao.get("geometry") or not campos["nome"]:
                ignorados += 1
                continue
            ano = campos["metadados"].get("ano_referencia")
            data_ref = opts["data_referencia"] or (date(ano, 1, 1) if ano else None)
            chave = {"tipo": tipo, "codigo_externo": campos["codigo_externo"]}
            if not campos["codigo_externo"]:
                chave["nome"] = campos["nome"]
            _, criada = AreaVerde.objects.update_or_create(
                **chave,
                defaults={
                    **{k: v for k, v in campos.items() if k not in chave},
                    "geom": _multipoligono(feicao["geometry"], srid),
                    "fonte": camada["fonte"],
                    "fonte_url": fonte_url,
                    "licenca": LICENCA,
                    "data_referencia": data_ref,
                    "ingerido_em": agora,
                },
            )
            criados += criada
            atualizados += not criada
        ausentes = (
            AreaVerde.objects.filter(tipo=tipo, fonte_url=fonte_url)
            .exclude(ingerido_em=agora)
            .count()
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"{TipoAreaVerde(tipo).label}: "
                f"{len(dados['features'])} na fonte, {criados} criada(s), "
                f"{atualizados} atualizada(s), {ignorados} ignorada(s) (sem geometria ou nome)."
            )
        )
        if ausentes:
            self.stdout.write(
                self.style.WARNING(
                    f"{ausentes} registro(s) já importado(s) não vieram desta vez; foram mantidos."
                )
            )
