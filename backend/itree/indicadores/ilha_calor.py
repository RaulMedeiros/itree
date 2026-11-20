"""Ilha de calor urbana de superfície por bairro (UrbVerde, IAU-USP).

Fonte: camada ``raster_temperatura_icus_nacional_2025`` do GeoServer da UrbVerde (a mesma que o
site da plataforma mostra como "Ilhas de calor urbano de superfície"). Cada pixel de 30 m é a
**diferença, em °C, entre a temperatura de superfície do pixel e a mediana do município**, no ano
(composição anual Landsat 8 e 9, Coleção 2, Nível 2), só sobre a mancha urbana. Não é temperatura
do ar nem temperatura absoluta; só se comparam áreas do mesmo município.

O valor do bairro é a **média dos pixels com medição cujo centro cai dentro do bairro**. O raster
vem do WCS do GeoServer, recortado na caixa dos bairros. Pixel sem medição (``-9999``) e dado
ausente (``100``, segundo o título do estilo da camada) ficam fora da média, e a cobertura (pixels
medidos ÷ pixels do bairro) é gravada junto: sem pixel medido não há valor.

**Licença.** O GeoServer declara Fees e AccessConstraints "none", mas os Termos de Uso da UrbVerde
dizem: dados "para fins acadêmicos, educacionais, públicos e de pesquisa, vedado o uso comercial
sem autorização prévia por escrito", "todos os direitos reservados", com citação obrigatória da
fonte. Não é licença aberta; por isso o valor por bairro só é **gravado** com
``URBVERDE_GRAVAR_VALORES`` ligado (desligado por padrão, até a prefeitura confirmar o uso com a
USP). Sem isso, a camada aparece no mapa por WMS, com atribuição, e o importador só calcula.
"""

import math
from dataclasses import dataclass, field
from datetime import date

import requests
from django.conf import settings
from django.contrib.gis.gdal import GDALRaster
from django.contrib.gis.geos import GEOSGeometry
from django.db import transaction
from django.db.models import Max, Min
from django.utils import timezone

from itree.territorio.models import Territorio, TipoTerritorio

from .models import IndicadorTerritorialExterno

INDICADOR = "ilha_calor_superficie_urbverde"
NOME = "Ilha de calor de superfície (UrbVerde, 2025)"
ANO = 2025
DATA_REFERENCIA = date(ANO, 12, 31)

URL_WCS = "https://urbverde.iau.usp.br/geoserver/urbverde/ows"
COBERTURA = "urbverde__raster_temperatura_icus_nacional_2025"
CAMADA_WMS = "urbverde:raster_temperatura_icus_nacional_2025"
URL_FONTE = "https://urbverde.iau.usp.br/"
URL_TERMOS = "https://urbverde.iau.usp.br/termos"

FONTE = "UrbVerde (IAU-USP): ilhas de calor urbano de superfície, 2025"
LICENCA = (
    "Termos de Uso da UrbVerde: uso acadêmico, educacional, público e de pesquisa, vedado o uso "
    "comercial sem autorização prévia por escrito; todos os direitos reservados; citar "
    "Plataforma UrbVerde – USP. Sem licença aberta declarada (GeoServer: Fees e AccessConstraints "
    '"none")'
)
DEFINICAO = (
    "Diferença média, em °C, entre a temperatura de superfície dos pixels do bairro e a mediana "
    "da temperatura de superfície do município (Fortaleza), no ano de 2025. Positivo indica "
    "superfície mais quente que a mediana da cidade; negativo, mais fresca. Não é temperatura do "
    "ar nem temperatura absoluta, e só vale para comparar áreas de Fortaleza entre si."
)
METODO = (
    "Raster nacional da UrbVerde (pixels de 30 m, composição anual Landsat 8 e 9, Coleção 2 "
    "Nível 2, sobre a mancha urbana dos setores censitários de 2022 mais 200 m), obtido pelo WCS "
    "do GeoServer da UrbVerde e recortado na caixa dos bairros. O valor do bairro é a média dos "
    "pixels com medição cujo centro cai dentro do polígono do bairro (limites do Ipplan); pixel "
    "sem medição (-9999) ou com dado ausente (100) não entra. Numerador = pixels medidos; "
    "denominador = pixels do bairro; a razão é a cobertura da medição. A média de Fortaleza é a "
    "média dos pixels medidos de todos os bairros, e não a média dos valores dos bairros."
)

SEM_MEDICAO = -9999.0
DADO_AUSENTE = 100.0
LIMITE_PIXEL = 100.0
MARGEM_GRAUS = 0.002
MAX_BYTES = 80 * 1024 * 1024


class RasterInvalido(ValueError):
    """O arquivo não é um raster de banda única legível."""


@dataclass
class Grade:
    """Raster em memória: valores por linha, de cima para baixo, e a geometria da grade."""

    largura: int
    altura: int
    x0: float
    y0: float
    dx: float
    dy: float
    valores: list[float]

    def linha(self, j: int) -> list[float]:
        return self.valores[j * self.largura : (j + 1) * self.largura]


@dataclass
class Medida:
    soma: float = 0.0
    validos: int = 0
    total: int = 0

    @property
    def media(self) -> float | None:
        return self.soma / self.validos if self.validos else None

    @property
    def cobertura(self) -> float | None:
        return self.validos / self.total if self.total else None


@dataclass
class Resultado:
    medidas: dict[str, Medida] = field(default_factory=dict)  # por id do território
    nomes: dict[str, str] = field(default_factory=dict)
    media_cidade: float | None = None
    gravados: int = 0
    sem_medicao: list[str] = field(default_factory=list)


def _valido(v: float) -> bool:
    return not math.isnan(v) and v != SEM_MEDICAO and -LIMITE_PIXEL < v < LIMITE_PIXEL


def ler_grade(conteudo: bytes) -> Grade:
    """Lê o GeoTIFF da primeira banda. O SRC da UrbVerde é o SIRGAS 2000 (EPSG:4674), que difere
    do WGS 84 dos bairros por menos de 1 m em Fortaleza; as coordenadas são usadas como estão."""
    try:
        raster = GDALRaster(conteudo)
        banda = raster.bands[0]
        valores = [float(v) for v in banda.data()]
        largura, altura = raster.width, raster.height
        x0, y0 = raster.origin
        dx, dy = raster.scale
    except Exception as exc:  # noqa: BLE001
        raise RasterInvalido(f"Raster ilegível: {exc}") from exc
    if len(valores) != largura * altura or dx <= 0 or dy >= 0:
        raise RasterInvalido("Grade do raster inesperada (esperada: norte para cima).")
    return Grade(largura, altura, x0, y0, dx, dy, valores)


def _arestas(geom: GEOSGeometry):
    poligonos = [geom] if geom.geom_type == "Polygon" else list(geom)
    for poligono in poligonos:
        for anel in poligono:
            pontos = anel.coords
            for (xa, ya), (xb, yb) in zip(pontos, pontos[1:], strict=False):
                if ya != yb:
                    yield xa, ya, xb, yb


def medir(geom: GEOSGeometry, grade: Grade) -> Medida:
    """Pixels cujo centro cai dentro de ``geom`` (regra par-ímpar, que respeita os buracos),
    por varredura de linhas: para cada linha da grade, os cruzamentos das arestas com o centro
    da linha dão os trechos de dentro."""
    ny = -grade.dy
    por_linha: dict[int, list[float]] = {}
    for xa, ya, xb, yb in _arestas(geom):
        y_baixo, y_alto = (ya, yb) if ya < yb else (yb, ya)
        j_ini = max(0, math.floor((grade.y0 - y_alto) / ny - 0.5) + 1)
        j_fim = min(grade.altura - 1, math.floor((grade.y0 - y_baixo) / ny - 0.5))
        for j in range(j_ini, j_fim + 1):
            yc = grade.y0 - (j + 0.5) * ny
            if y_baixo <= yc < y_alto:
                por_linha.setdefault(j, []).append(xa + (yc - ya) * (xb - xa) / (yb - ya))
    medida = Medida()
    for j, cruzamentos in por_linha.items():
        cruzamentos.sort()
        linha = grade.linha(j)
        for esquerda, direita in zip(cruzamentos[0::2], cruzamentos[1::2], strict=False):
            i_ini = max(0, math.ceil((esquerda - grade.x0) / grade.dx - 0.5))
            i_fim = min(grade.largura - 1, math.ceil((direita - grade.x0) / grade.dx - 0.5) - 1)
            if i_fim < i_ini:
                continue
            trecho = linha[i_ini : i_fim + 1]
            medida.total += len(trecho)
            medidos = [v for v in trecho if _valido(v)]
            medida.validos += len(medidos)
            medida.soma += sum(medidos)
    return medida


def caixa_dos_bairros() -> tuple[float, float, float, float] | None:
    """(oeste, sul, leste, norte) que cobre todos os bairros, com uma folga."""
    from django.contrib.gis.db.models import Extent

    extensao = Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO).aggregate(e=Extent("geom"))[
        "e"
    ]
    if not extensao:
        return None
    oeste, sul, leste, norte = extensao
    return (
        oeste - MARGEM_GRAUS,
        sul - MARGEM_GRAUS,
        leste + MARGEM_GRAUS,
        norte + MARGEM_GRAUS,
    )


def baixar(caixa: tuple[float, float, float, float], url: str = URL_WCS) -> bytes:
    """Recorte do raster pelo WCS 2.0.1 do GeoServer da UrbVerde (GeoTIFF)."""
    oeste, sul, leste, norte = caixa
    resposta = requests.get(
        url,
        params=[
            ("service", "WCS"),
            ("version", "2.0.1"),
            ("request", "GetCoverage"),
            ("coverageId", COBERTURA),
            ("format", "image/tiff"),
            ("subset", f"Long({oeste:.5f},{leste:.5f})"),
            ("subset", f"Lat({sul:.5f},{norte:.5f})"),
        ],
        timeout=getattr(settings, "URBVERDE_TIMEOUT", 180),
        stream=True,
    )
    resposta.raise_for_status()
    if "tiff" not in resposta.headers.get("Content-Type", "").lower():
        raise RasterInvalido(
            f"O WCS não devolveu GeoTIFF ({resposta.headers.get('Content-Type', '?')})."
        )
    pedacos, total = [], 0
    for pedaco in resposta.iter_content(1024 * 1024):
        total += len(pedaco)
        if total > MAX_BYTES:
            raise RasterInvalido("Resposta do WCS maior que o limite.")
        pedacos.append(pedaco)
    return b"".join(pedacos)


def calcular(grade: Grade) -> Resultado:
    """Mede cada bairro cadastrado e a média ponderada da cidade (soma ÷ pixels medidos)."""
    resultado = Resultado()
    soma = validos = 0
    for bairro in Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO).only("id", "nome", "geom"):
        medida = medir(bairro.geom, grade)
        resultado.nomes[str(bairro.pk)] = bairro.nome
        if medida.validos:
            resultado.medidas[str(bairro.pk)] = medida
            soma += medida.soma
            validos += medida.validos
        else:
            resultado.sem_medicao.append(bairro.nome)
    resultado.media_cidade = soma / validos if validos else None
    return resultado


def gravar_permitido() -> bool:
    return bool(getattr(settings, "URBVERDE_GRAVAR_VALORES", False))


def gravar(resultado: Resultado, *, fonte_url: str = URL_FONTE, ingerido_em=None) -> int:
    """Grava o valor de cada bairro medido; some o que deixou de ter medição. Idempotente."""
    agora = ingerido_em or timezone.now()
    with transaction.atomic():
        for id_, medida in resultado.medidas.items():
            IndicadorTerritorialExterno.objects.update_or_create(
                territorio_id=id_,
                indicador=INDICADOR,
                defaults={
                    "valor": round(medida.media, 2),
                    "numerador": medida.validos,
                    "denominador": medida.total,
                    "unidade": "°C",
                    "fonte": FONTE,
                    "fonte_url": fonte_url,
                    "licenca": LICENCA,
                    "data_referencia": DATA_REFERENCIA,
                    "ingerido_em": agora,
                    "definicao": DEFINICAO,
                    "metodo": METODO,
                },
            )
        IndicadorTerritorialExterno.objects.filter(indicador=INDICADOR).exclude(
            territorio_id__in=list(resultado.medidas)
        ).delete()
    resultado.gravados = len(resultado.medidas)
    return resultado.gravados


def importar(conteudo: bytes, *, fonte_url: str = URL_FONTE, ingerido_em=None) -> Resultado:
    """Calcula o valor por bairro e, só com ``URBVERDE_GRAVAR_VALORES`` ligado, grava."""
    resultado = calcular(ler_grade(conteudo))
    if gravar_permitido():
        gravar(resultado, fonte_url=fonte_url, ingerido_em=ingerido_em)
    return resultado


def media_da_cidade() -> dict | None:
    """Média ponderada de Fortaleza (pixels medidos de cada bairro) entre os valores gravados."""
    linhas = list(
        IndicadorTerritorialExterno.objects.filter(
            indicador=INDICADOR, valor__isnull=False, numerador__gt=0
        ).values_list("valor", "numerador")
    )
    pixels = sum(n for _, n in linhas)
    if not pixels:
        return None
    return {
        "valor": round(float(sum(float(v) * n for v, n in linhas)) / pixels, 2),
        "bairros": len(linhas),
    }


def extensao_dos_valores() -> tuple[float, float] | None:
    """Menor e maior valor entre os bairros, para a régua."""
    ext = IndicadorTerritorialExterno.objects.filter(indicador=INDICADOR).aggregate(
        menor=Min("valor"), maior=Max("valor")
    )
    return (float(ext["menor"]), float(ext["maior"])) if ext["menor"] is not None else None
