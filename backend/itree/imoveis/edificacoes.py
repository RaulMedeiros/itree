"""Edificações: leitura do Google Open Buildings v3 e carga em lote.

Fonte escolhida: **Google Open Buildings v3** (contornos de edificações detectados em imagem de
satélite por aprendizado de máquina; licença **CC BY 4.0**, com citação; Brasil coberto). A célula
S2 de nível 6 ``07c7`` cobre todo o município de Fortaleza (os quatro cantos da caixa do município
caem nela; verificado em 21/11/2026). Os arquivos são CSV compactado **sem cabeçalho**, com as
colunas ``latitude, longitude, area_in_meters, confidence, geometry (WKT), full_plus_code``.

A alternativa, o OpenStreetMap (``building=*``, ODbL), cobre bem menos edificações em Fortaleza e
exige a atribuição "© colaboradores do OpenStreetMap"; fica no backlog.

O arquivo é dado não confiável: leitura em fluxo, linha a linha, com limites de tamanho; linhas
fora do município (pelo ponto central que a fonte informa), com número ilegível, confiança fora de
0 a 1 ou geometria que não seja polígono simples são descartadas e contadas.
"""

import csv
import gzip
import hashlib
import io
import math
import re
import tempfile
import time
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import requests
from django.contrib.gis.geos import GEOSGeometry, Point
from django.db import connection, transaction
from django.utils import timezone

from itree.territorio.models import Territorio, TipoTerritorio

from .models import Edificacao, FonteEdificacao, LoteEdificacoes

CELULA_S2 = "07c7"
HOST_PERMITIDO = "storage.googleapis.com"
URL_OPEN_BUILDINGS = (
    f"https://{HOST_PERMITIDO}/open-buildings-data/v3/polygons_s2_level_6_gzip_no_header/"
    f"{CELULA_S2}_buildings.csv.gz"
)
FONTE = (
    "Google Research, Open Buildings v3 (contornos de edificações detectados em imagem de satélite)"
)
LICENCA = "Creative Commons Attribution 4.0 (CC BY 4.0); citar Google Research, Open Buildings v3"
DATA_REFERENCIA = date(2023, 5, 1)  # data de publicação da v3; a imagem varia por região
MAX_BYTES_DOWNLOAD = 400 * 1024 * 1024
MAX_LINHA = 20_000
MAX_AREA_M2 = 1_000_000  # acima disso o "polígono" não é uma edificação (galpão, erro de detecção)
COLUNAS = ["latitude", "longitude", "area_in_meters", "confidence", "geometry", "full_plus_code"]
PADRAO_POLIGONO = re.compile(r"^POLYGON \(\(.*\)\)$|^POLYGON\(\(.*\)\)$", re.DOTALL)
TIMEOUT_S = 120


class ArquivoInvalido(ValueError):
    """O arquivo não tem o formato do Open Buildings."""


@dataclass
class Leitura:
    linhas_lidas: int = 0
    aceitas: int = 0
    fora_do_municipio: int = 0
    invalidas: int = 0
    abaixo_da_confianca: int = 0
    sha256: str = ""
    caixa: tuple[float, float, float, float] | None = None  # oeste, sul, leste, norte


@dataclass
class Resultado:
    lote: LoteEdificacoes | None = None
    leitura: Leitura = field(default_factory=Leitura)
    importadas: int = 0
    geometria_invalida: int = 0
    sem_bairro: int = 0
    duracao_s: float = 0.0


def municipio_geometria() -> GEOSGeometry:
    """Limite do município (ou a união dos bairros, se o município não existir)."""
    municipio = Territorio.objects.filter(tipo=TipoTerritorio.MUNICIPIO).first()
    if municipio is not None:
        return municipio.geom
    bairros = list(
        Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO).values_list("geom", flat=True)
    )
    if not bairros:
        raise ArquivoInvalido(
            "Importe os limites (importar_limites_fortaleza) antes das edificações."
        )
    uniao = bairros[0]
    for g in bairros[1:]:
        uniao = uniao.union(g)
    return uniao


def _abrir(caminho: Path):
    """Arquivo de texto, compactado (.gz) ou não."""
    if caminho.suffix == ".gz":
        return io.TextIOWrapper(gzip.open(caminho, "rb"), encoding="utf-8", newline="")
    return open(caminho, encoding="utf-8", newline="")  # noqa: SIM115


def _linhas_validas(caminho: Path, limite, leitura: Leitura, confianca_minima: float):
    """Gera (lat, lon, area, confianca, wkt, plus_code) das linhas aceitas."""
    prepared = limite.prepared
    oeste, sul, leste, norte = limite.extent
    csv.field_size_limit(MAX_LINHA)
    with _abrir(caminho) as arquivo:
        leitor = csv.reader(arquivo)
        for linha in leitor:
            if linha and linha[0] == "latitude":
                continue  # a variante com cabeçalho
            leitura.linhas_lidas += 1
            if len(linha) != len(COLUNAS):
                leitura.invalidas += 1
                continue
            try:
                lat, lon = float(linha[0]), float(linha[1])
                area = float(linha[2])
                conf = float(linha[3])
            except ValueError:
                leitura.invalidas += 1
                continue
            if not (
                math.isfinite(lat)
                and math.isfinite(lon)
                and math.isfinite(area)
                and math.isfinite(conf)
            ):
                leitura.invalidas += 1
                continue
            # Caixa primeiro (barato); só depois o teste exato com o limite municipal.
            if not (oeste <= lon <= leste and sul <= lat <= norte):
                leitura.fora_do_municipio += 1
                continue
            if not prepared.contains(Point(lon, lat, srid=4326)):
                leitura.fora_do_municipio += 1
                continue
            wkt = linha[4]
            if (
                not (0 < area <= MAX_AREA_M2)
                or not (0 <= conf <= 1)
                or not PADRAO_POLIGONO.match(wkt)
            ):
                leitura.invalidas += 1
                continue
            if conf < confianca_minima:
                leitura.abaixo_da_confianca += 1
                continue
            leitura.aceitas += 1
            yield lat, lon, area, conf, wkt, linha[5][:40]


def _sha256(caminho: Path) -> str:
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1024 * 1024), b""):
            h.update(bloco)
    return h.hexdigest()


def baixar(destino: Path, url: str = URL_OPEN_BUILDINGS, limite: int = MAX_BYTES_DOWNLOAD) -> Path:
    """Baixa o arquivo da célula para ``destino`` (só do host permitido, com limite de bytes)."""
    from urllib.parse import urlparse

    partes = urlparse(url)
    if partes.scheme != "https" or partes.hostname != HOST_PERMITIDO:
        raise ArquivoInvalido(f"Só se baixa de https://{HOST_PERMITIDO}/ ({url}).")
    resposta = requests.get(url, stream=True, timeout=TIMEOUT_S)
    resposta.raise_for_status()
    total = 0
    with open(destino, "wb") as f:
        for bloco in resposta.iter_content(1024 * 1024):
            total += len(bloco)
            if total > limite:
                raise ArquivoInvalido("Arquivo maior que o limite de download.")
            f.write(bloco)
    return destino


def importar(
    caminho: Path,
    *,
    fonte: str = FonteEdificacao.OPEN_BUILDINGS,
    fonte_url: str = URL_OPEN_BUILDINGS,
    confianca_minima: float = 0.0,
    limite=None,
    ingerido_em=None,
) -> Resultado:
    """Carrega as edificações do arquivo, recortadas pelo município, trocando as da mesma fonte.

    A carga usa ``COPY`` para uma tabela temporária e um único ``INSERT ... SELECT`` que monta a
    geometria, o ponto central, descarta geometria inválida e resolve o bairro. Tudo numa transação:
    se algo falhar, as edificações anteriores continuam.
    """
    inicio = time.monotonic()
    limite = limite or municipio_geometria()
    resultado = Resultado()
    leitura = resultado.leitura
    leitura.sha256 = _sha256(caminho)
    agora = ingerido_em or timezone.now()
    with transaction.atomic():
        lote = LoteEdificacoes.objects.create(
            fonte=fonte,
            fonte_texto=FONTE,
            fonte_url=fonte_url,
            licenca=LICENCA,
            data_referencia=DATA_REFERENCIA,
            ingerido_em=agora,
            arquivo_sha256=leitura.sha256,
        )
        with connection.cursor() as cursor:
            cursor.execute("DROP TABLE IF EXISTS tmp_edificacao")
            cursor.execute(
                "CREATE TEMP TABLE tmp_edificacao (lat float8, lon float8, area float8,"
                " conf float8, wkt text, codigo text) ON COMMIT DROP"
            )
            with cursor.cursor.copy(
                "COPY tmp_edificacao (lat, lon, area, conf, wkt, codigo) FROM STDIN"
            ) as copia:
                for linha in _linhas_validas(caminho, limite, leitura, confianca_minima):
                    copia.write_row(linha)
            Edificacao.objects.filter(fonte=fonte).delete()
            cursor.execute(
                """
                INSERT INTO imoveis_edificacao
                    (lote_id, fonte, codigo_externo, geom, centro, area_m2, confianca, uso)
                SELECT %s, %s, codigo, g, ST_PointOnSurface(g), area, conf, ''
                  FROM (SELECT t.*, ST_SetSRID(ST_GeomFromText(wkt), 4326) AS g
                          FROM tmp_edificacao t) x
                 WHERE ST_GeometryType(g) = 'ST_Polygon' AND ST_IsValid(g)
                """,
                [str(lote.pk), fonte],
            )
            resultado.importadas = cursor.rowcount
            resultado.geometria_invalida = leitura.aceitas - resultado.importadas
            cursor.execute(
                """
                UPDATE imoveis_edificacao e SET bairro_id = t.id
                  FROM territorio_territorio t
                 WHERE e.lote_id = %s AND t.tipo = 'bairro' AND ST_Contains(t.geom, e.centro)
                """,
                [str(lote.pk)],
            )
            cursor.execute(
                "SELECT count(*) FROM imoveis_edificacao WHERE lote_id = %s AND bairro_id IS NULL",
                [str(lote.pk)],
            )
            resultado.sem_bairro = cursor.fetchone()[0]
            cursor.execute("ANALYZE imoveis_edificacao")
        lote.linhas_lidas = leitura.linhas_lidas
        lote.importadas = resultado.importadas
        lote.fora_do_municipio = leitura.fora_do_municipio
        lote.invalidas = leitura.invalidas + resultado.geometria_invalida
        lote.confianca_minima = confianca_minima or None
        lote.duracao_s = round(time.monotonic() - inicio, 1)
        lote.metadados = {
            "abaixo_da_confianca": leitura.abaixo_da_confianca,
            "sem_bairro": resultado.sem_bairro,
            "celula_s2": CELULA_S2,
        }
        lote.save()
    resultado.lote = lote
    resultado.duracao_s = lote.duracao_s
    return resultado


def importar_da_rede(**opcoes) -> Resultado:
    """Baixa a célula para um diretório temporário, importa e apaga o arquivo."""
    with tempfile.TemporaryDirectory(prefix="itree-edificacoes-") as pasta:
        caminho = baixar(Path(pasta) / f"{CELULA_S2}_buildings.csv.gz")
        return importar(caminho, **opcoes)
