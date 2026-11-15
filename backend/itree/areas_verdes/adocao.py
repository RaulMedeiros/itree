"""Adoção de praças e áreas verdes (Fortaleza em Mapas, mapa 622, SEUMA).

A fonte traz, por ponto: ``Nome`` (da praça), ``Adotante``, ``Regional``, ``x``/``y`` (UTM),
``Fonte`` e ``ano_ref``. **``Adotante`` é nome de pessoa ou razão social e é descartado já na
leitura**: ``ler_adocoes`` monta cada registro só com os campos permitidos e usa o texto do
adotante apenas para decidir a categoria (empresa, associação ou condomínio), sem guardá-lo,
devolvê-lo nem registrá-lo em log. Nada mais da fonte que identifique pessoa existe (não há
contato, documento nem data do termo).

O ponto é ligado à praça (``AreaVerde`` do tipo praça) mais próxima a até ``RAIO_VINCULO_M``,
pela distância geodésica até o contorno; sem praça nesse raio, o ponto fica sem vínculo, com o
motivo.
"""

import re
from dataclasses import dataclass, field
from datetime import date

from django.contrib.gis.geos import Point
from django.db import connection, transaction
from django.utils import timezone

from .models import AdocaoPraca, AreaVerde, MotivoSemVinculo, TipoAdotante, TipoAreaVerde

MAPA = 622
RAIO_VINCULO_M = 50
FONTE = "Fortaleza em Mapas (Ipplan Fortaleza): Adoção de Praças e Áreas Verdes, SEUMA"

# Marcas de forma jurídica na razão social. Pessoa física, nome de fantasia e o que não tem
# marca clara ficam "não classificado": nunca se afirma que o adotante é uma pessoa.
_ASSOCIACAO = re.compile(
    r"\b(associa[cç][aã]o|condom[ií]nio|funda[cç][aã]o|sindicato|cooperativa|igreja)\b", re.I
)
_EMPRESA = re.compile(
    r"\b(ltda|eireli|epp|mei|construtora|incorporadora|empreendimentos?|imobili[aá]ria"
    r"|com[eé]rcio|ind[uú]stria)\b"
    r"|\bs\.\s?a\b\.?|\bs/a\b|(?:^|[\s-])me$",
    re.I,
)


class AdocaoInvalida(ValueError):
    """O arquivo não tem o formato do mapa 622."""


def tipo_do_adotante(texto) -> str:
    """Categoria do adotante a partir do texto da fonte. O texto não sai desta função."""
    texto = " ".join(str(texto or "").split())
    if _ASSOCIACAO.search(texto):
        return TipoAdotante.ASSOCIACAO
    if _EMPRESA.search(texto):
        return TipoAdotante.EMPRESA
    return TipoAdotante.NAO_CLASSIFICADO


@dataclass
class Adocao:
    """Só o que pode ser gravado. Não há campo para o adotante."""

    codigo_externo: str
    nome: str
    regional: str
    tipo_adotante: str
    geom: Point
    ano_referencia: int | None


@dataclass
class LeituraAdocoes:
    adocoes: list[Adocao] = field(default_factory=list)
    ignoradas: int = 0  # sem ponto, sem identificador ou sem nome


def _texto(valor) -> str:
    return " ".join(str(valor).split()) if valor not in (None, "") else ""


def _ponto(geometria, srid: int) -> Point | None:
    if not isinstance(geometria, dict) or geometria.get("type") != "Point":
        return None
    try:
        lon, lat = (float(c) for c in geometria["coordinates"][:2])
    except (KeyError, TypeError, ValueError):
        return None
    if srid != 4326:
        return None  # o mapa 622 declara 4326; outro SRC exigiria conversão que não foi conferida
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None
    return Point(lon, lat, srid=4326)


def ler_adocoes(dados: dict, srid: int = 4326) -> LeituraAdocoes:
    """Registros permitidos de uma FeatureCollection do mapa 622, sem o adotante."""
    if not isinstance(dados, dict) or not isinstance(dados.get("features"), list):
        raise AdocaoInvalida("A fonte não devolveu uma FeatureCollection GeoJSON.")
    leitura = LeituraAdocoes()
    vistos: set[str] = set()
    for feicao in dados["features"]:
        if not isinstance(feicao, dict):
            leitura.ignoradas += 1
            continue
        props = feicao.get("properties") or {}
        ponto = _ponto(feicao.get("geometry"), srid)
        codigo, nome = _texto(props.get("id")), _texto(props.get("Nome"))
        if ponto is None or not codigo or not nome or codigo in vistos:
            leitura.ignoradas += 1
            continue
        vistos.add(codigo)
        try:
            ano = int(str(props.get("ano_ref")).strip())
        except ValueError:
            ano = None
        leitura.adocoes.append(
            Adocao(
                codigo_externo=codigo[:50],
                nome=nome[:250],
                regional=_texto(props.get("Regional"))[:50],
                tipo_adotante=tipo_do_adotante(props.get("Adotante")),
                geom=ponto,
                ano_referencia=ano,
            )
        )
    return leitura


def praca_mais_proxima(ponto: Point, raio_m: float = RAIO_VINCULO_M) -> tuple[str, float] | None:
    """(id da praça, distância em metros) da praça mais próxima dentro do raio, ou ``None``."""
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT a.id, ST_Distance(a.geom::geography, pt.g) AS distancia
              FROM {AreaVerde._meta.db_table} a,
                   (SELECT ST_GeomFromEWKB(%s)::geography AS g) pt
             WHERE a.tipo = %s AND ST_DWithin(a.geom::geography, pt.g, %s)
             ORDER BY distancia, a.nome, a.id
             LIMIT 1
            """,  # noqa: S608 - só o nome da tabela é interpolado, vem do modelo
            [ponto.ewkb, TipoAreaVerde.PRACA, raio_m],
        )
        linha = cursor.fetchone()
    return (str(linha[0]), float(linha[1])) if linha else None


@dataclass
class ResultadoAdocao:
    lidas: int = 0
    ignoradas: int = 0
    criadas: int = 0
    atualizadas: int = 0
    removidas: int = 0
    ligadas: int = 0
    sem_vinculo: int = 0
    tipos: dict[str, int] = field(default_factory=dict)
    pracas_adotadas: int = 0


def importar(
    dados: dict, *, fonte_url: str, licenca: str, srid: int = 4326, data_referencia=None, agora=None
) -> ResultadoAdocao:
    """Grava as adoções e liga cada uma à praça mais próxima. Idempotente por ``id`` da fonte; o
    que não está mais na fonte é removido (a adoção terminou). Tudo numa transação."""
    agora = agora or timezone.now()
    leitura = ler_adocoes(dados, srid)
    if not leitura.adocoes:
        raise AdocaoInvalida("A fonte não trouxe nenhuma adoção com ponto e nome.")
    r = ResultadoAdocao(lidas=len(leitura.adocoes) + leitura.ignoradas, ignoradas=leitura.ignoradas)
    with transaction.atomic():
        existentes = set(AdocaoPraca.objects.values_list("codigo_externo", flat=True))
        for a in leitura.adocoes:
            proxima = praca_mais_proxima(a.geom)
            data_ref = data_referencia or (
                date(a.ano_referencia, 1, 1) if a.ano_referencia else None
            )
            _, criada = AdocaoPraca.objects.update_or_create(
                codigo_externo=a.codigo_externo,
                defaults={
                    "nome": a.nome,
                    "regional": a.regional,
                    "tipo_adotante": a.tipo_adotante,
                    "geom": a.geom,
                    "ano_referencia": a.ano_referencia,
                    "area_verde_id": proxima[0] if proxima else None,
                    "distancia_m": round(proxima[1], 1) if proxima else None,
                    "motivo_sem_vinculo": "" if proxima else MotivoSemVinculo.NENHUMA_PRACA_PROXIMA,
                    "fonte": FONTE,
                    "fonte_url": fonte_url,
                    "licenca": licenca,
                    "data_referencia": data_ref,
                    "ingerido_em": agora,
                },
            )
            r.criadas += criada
            r.atualizadas += not criada
            r.ligadas += bool(proxima)
            r.sem_vinculo += not proxima
            r.tipos[a.tipo_adotante] = r.tipos.get(a.tipo_adotante, 0) + 1
        obsoletas = existentes - {a.codigo_externo for a in leitura.adocoes}
        r.removidas = AdocaoPraca.objects.filter(codigo_externo__in=obsoletas).delete()[0]
        r.pracas_adotadas = (
            AdocaoPraca.objects.filter(area_verde__isnull=False)
            .values("area_verde")
            .distinct()
            .count()
        )
    return r
