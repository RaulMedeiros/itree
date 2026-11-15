"""Leitura e importação da planilha de iluminação pública da prefeitura (SEINF).

A fonte é um XLSX do portal de dados abertos (CKAN) com uma linha por lâmpada. Aqui as
linhas viram um ponto por código de serviço, com as lâmpadas como atributo. O arquivo é dado
não confiável: tipos e faixas são validados e o que não passa é descartado e contado.
"""

import hashlib
import re
import tempfile
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

import requests
from django.contrib.gis.gdal import CoordTransform, SpatialReference
from django.contrib.gis.geos import Point
from django.db import transaction
from django.utils import timezone

from itree.core.geo import SRID_METRICO, ResolvedorDeBairro

from .models import LoteIluminacao, PontoIluminacao

URL_OFICIAL = (
    "https://dados.fortaleza.ce.gov.br/dataset/b21546fe-784c-4d9c-87cf-733f67a4056c/resource/"
    "9f933d1c-5642-4545-a247-83cdd0375715/download/relatoriodoparquedeiluminacaopublica.xlsx"
)
HOSTS_PERMITIDOS = {"dados.fortaleza.ce.gov.br"}
FONTE = (
    "Prefeitura de Fortaleza, SEINF: Pontos de iluminação pública "
    "(dados abertos, dataset pontos_iluminacao_publica)"
)
LICENCA = "Creative Commons Atribuição-CompartilhaIgual (CC BY-SA)"
# Última atualização do conjunto declarada no portal em 15/11/2026.
DATA_REFERENCIA = date(2022, 11, 16)
ABA = "CREXPORT"
LIMITE_DOWNLOAD_BYTES = 64 * 1024 * 1024
LIMITE_DESCOMPACTADO_BYTES = 1024 * 1024 * 1024
LIMITE_LINHAS = 1_000_000
LIMITE_LAMPADAS_POR_PONTO = 50
TIMEOUT_S = 120
LOTE_BULK = 5000
# SIRGAS 2000 / UTM 24S: faixa plausível do hemisfério sul na zona 24 (fuso de Fortaleza).
FAIXA_X = (100_000.0, 900_000.0)
FAIXA_Y = (9_000_000.0, 10_000_000.0)
# Caixa folgada de Fortaleza, usada quando não há limite municipal importado.
CAIXA_FORTALEZA = (-38.70, -4.00, -38.38, -3.65)
ALTURA_MAXIMA_M = 60.0
# Folga no limite do município: a coordenada da fonte e o polígono oficial não coincidem ao metro,
# e 964 dos 1.711 pontos que caem fora (na verificação de 15/11/2026) estão a até 50 m dele.
TOLERANCIA_LIMITE_M = 50.0

_ALTURA = re.compile(
    r"\s*(?:DE\s+(\d+(?:[.,]\d+)?)\s*M?\s+A\s+(\d+(?:[.,]\d+)?)\s*M|AT[ÉE]\s+(\d+(?:[.,]\d+)?)\s*M)\s*$",
    re.IGNORECASE,
)
_CONTROLE = re.compile(r"[\x00-\x1f\x7f]")


class ErroPlanilha(Exception):
    """Arquivo ilegível ou fora do formato esperado."""


def texto(valor, limite: int = 200) -> str:
    """Texto da célula sem espaços das pontas, com espaços internos colapsados e sem controles."""
    if valor is None:
        return ""
    return " ".join(_CONTROLE.sub(" ", str(valor)).split())[:limite]


def numero(valor) -> float | None:
    """Número da célula (número, ou texto com vírgula ou ponto); ``None`` se vazio ou ilegível."""
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int | float):
        resultado = float(valor)
    else:
        bruto = texto(valor).replace(",", ".")
        if not bruto:
            return None
        try:
            resultado = float(bruto)
        except ValueError:
            return None
    return resultado if resultado == resultado and abs(resultado) != float("inf") else None


def codigo_do_ponto(valor) -> str:
    """Código do ponto como texto, sem ``.0`` quando a célula é numérica."""
    if isinstance(valor, float) and valor.is_integer():
        valor = int(valor)
    return texto(valor, 60)


def separar_poste(bruto) -> tuple[str, float | None, float | None]:
    """Tipo do poste e faixa de altura do texto da fonte.

    ``"CONCRETO DUPLO T DE 5 A 10 M"`` vira ``("CONCRETO DUPLO T", 5.0, 10.0)`` e
    ``"SUPORTE ATÉ 5 M"``, ``("SUPORTE", None, 5.0)``. Sem faixa, o texto inteiro é o tipo e as
    alturas ficam vazias.
    """
    original = texto(bruto, 100)
    achado = _ALTURA.search(original)
    if not achado:
        return original, None, None
    tipo = original[: achado.start()].strip()
    if achado.group(3):
        minima, maxima = None, float(achado.group(3).replace(",", "."))
    else:
        minima = float(achado.group(1).replace(",", "."))
        maxima = float(achado.group(2).replace(",", "."))
    if (maxima is not None and not 0 < maxima <= ALTURA_MAXIMA_M) or (
        minima is not None and not 0 < minima <= maxima
    ):
        return original, None, None
    return tipo, minima, maxima


COLUNAS = {
    "codigo": ("CÓDIGO_DE_PONTO_DE_SERVIÇO", "CODIGO_DE_PONTO_DE_SERVICO"),
    "x": ("PONTO_DE_SERVIÇO_X", "PONTO_DE_SERVICO_X"),
    "y": ("PONTE_DE_SERVIÇO_Y", "PONTO_DE_SERVIÇO_Y", "PONTE_DE_SERVICO_Y", "PONTO_DE_SERVICO_Y"),
    "regional": ("REGIÃO", "REGIAO"),
    "logradouro": ("DESIGNAÇÃO_LOGRADOURO", "DESIGNACAO_LOGRADOURO"),
    "bairro": ("DESIGNAÇÃO_BAIRRO", "DESIGNACAO_BAIRRO"),
    "poste": ("POSTE",),
    "lampada": ("LÂMPADA", "LAMPADA"),
    "potencia_nominal": ("POTÊNCIA_NOMINAL", "POTENCIA_NOMINAL"),
    "potencia_consumida": ("POTÊNCIA_CONSUMIDA", "POTENCIA_CONSUMIDA"),
    "familia": ("FAMILIA_LÂMPADA", "FAMILIA_LAMPADA", "FAMÍLIA_LÂMPADA"),
}
OBRIGATORIAS = ("codigo", "x", "y")


def _mapa_de_colunas(cabecalho) -> dict[str, int]:
    nomes = {texto(c).upper(): i for i, c in enumerate(cabecalho)}
    mapa = {}
    for campo, candidatos in COLUNAS.items():
        for nome in candidatos:
            if nome in nomes:
                mapa[campo] = nomes[nome]
                break
    faltam = [COLUNAS[c][0] for c in OBRIGATORIAS if c not in mapa]
    if faltam:
        raise ErroPlanilha(f"A planilha não tem a(s) coluna(s) {', '.join(faltam)}.")
    return mapa


def abrir_linhas(caminho: Path) -> Iterator[dict]:
    """Linhas da aba ``CREXPORT`` como dicionários campo -> valor bruto."""
    from openpyxl import load_workbook

    try:
        with zipfile.ZipFile(caminho) as z:
            if sum(i.file_size for i in z.infolist()) > LIMITE_DESCOMPACTADO_BYTES:
                raise ErroPlanilha("O arquivo descompactado passa do limite de tamanho.")
        livro = load_workbook(caminho, read_only=True, data_only=True)
    except ErroPlanilha:
        raise
    except Exception as exc:  # noqa: BLE001 - openpyxl levanta vários tipos para arquivo ruim
        raise ErroPlanilha(f"Não foi possível ler a planilha: {exc}") from exc
    try:
        aba = livro[ABA] if ABA in livro.sheetnames else livro.worksheets[0]
        linhas = aba.iter_rows(values_only=True)
        cabecalho = next(linhas, None)
        if cabecalho is None:
            raise ErroPlanilha("A planilha está vazia.")
        mapa = _mapa_de_colunas(cabecalho)
        for n, linha in enumerate(linhas, 1):
            if n > LIMITE_LINHAS:
                raise ErroPlanilha(f"A planilha passa do limite de {LIMITE_LINHAS} linhas.")
            yield {c: (linha[i] if i < len(linha) else None) for c, i in mapa.items()}
    finally:
        livro.close()


@dataclass
class PontoLido:
    codigo: str
    x: float | None = None
    y: float | None = None
    coordenada_invalida: bool = False
    regional: str = ""
    bairro: str = ""
    logradouro: str = ""
    poste_tipo: str = ""
    altura_min: float | None = None
    altura_max: float | None = None
    lampadas: list[dict] = field(default_factory=list)


@dataclass
class Leitura:
    linhas: int = 0
    sem_codigo: int = 0
    pontos: dict[str, PontoLido] = field(default_factory=dict)


def agregar(linhas: Iterator[dict]) -> Leitura:
    """Uma entrada por código de ponto; as lâmpadas das linhas repetidas viram a lista."""
    leitura = Leitura()
    for linha in linhas:
        leitura.linhas += 1
        codigo = codigo_do_ponto(linha.get("codigo"))
        if not codigo:
            leitura.sem_codigo += 1
            continue
        ponto = leitura.pontos.get(codigo)
        if ponto is None:
            tipo, minima, maxima = separar_poste(linha.get("poste"))
            ponto = leitura.pontos[codigo] = PontoLido(
                codigo=codigo,
                regional=texto(linha.get("regional"), 60),
                bairro=texto(linha.get("bairro"), 120),
                logradouro=texto(linha.get("logradouro"), 200),
                poste_tipo=tipo,
                altura_min=minima,
                altura_max=maxima,
            )
        if ponto.x is None and not ponto.coordenada_invalida:
            bruto_x, bruto_y = linha.get("x"), linha.get("y")
            if texto(bruto_x) or texto(bruto_y):
                x, y = numero(bruto_x), numero(bruto_y)
                if (
                    x is not None
                    and y is not None
                    and FAIXA_X[0] <= x <= FAIXA_X[1]
                    and FAIXA_Y[0] <= y <= FAIXA_Y[1]
                ):
                    ponto.x, ponto.y = x, y
                else:
                    ponto.coordenada_invalida = True
        lampada = texto(linha.get("lampada"), 80)
        if lampada and len(ponto.lampadas) < LIMITE_LAMPADAS_POR_PONTO:
            ponto.lampadas.append(
                {
                    "tipo": lampada,
                    "potencia_nominal_w": numero(linha.get("potencia_nominal")),
                    "potencia_consumida_w": numero(linha.get("potencia_consumida")),
                    "familia": texto(linha.get("familia"), 60),
                }
            )
    return leitura


class LimiteDoMunicipio:
    """Teste "dentro do município": caixa folgada de Fortaleza e, havendo, o limite oficial.

    O limite oficial ganha ``TOLERANCIA_LIMITE_M`` metros de folga (buffer calculado em metros, no
    SRC métrico de Fortaleza). Sem município importado, vale só a caixa.
    """

    def __init__(self):
        from itree.territorio.models import Territorio, TipoTerritorio

        self._limite = None
        geometrias = [
            m.geom
            for m in Territorio.objects.filter(tipo=TipoTerritorio.MUNICIPIO).only("id", "geom")
        ]
        if geometrias:
            uniao = geometrias[0]
            for g in geometrias[1:]:
                uniao = uniao.union(g)
            uniao.srid = 4326
            folgado = uniao.transform(SRID_METRICO, clone=True).buffer(TOLERANCIA_LIMITE_M)
            folgado.transform(4326)
            self._limite = folgado.prepared

    def contem(self, geom) -> bool:
        oeste, sul, leste, norte = CAIXA_FORTALEZA
        if not (oeste <= geom.x <= leste and sul <= geom.y <= norte):
            return False
        return self._limite is None or self._limite.contains(geom)


@dataclass
class Resultado:
    lote: LoteIluminacao
    descartados: int


def baixar(url: str = URL_OFICIAL, destino: Path | None = None) -> Path:
    """Baixa o XLSX oficial (só HTTPS, só dos hosts permitidos, com limite de tamanho)."""

    def conferir(endereco: str) -> None:
        partes = urlsplit(endereco)
        if partes.scheme != "https" or partes.hostname not in HOSTS_PERMITIDOS:
            raise ErroPlanilha(f"Endereço não permitido: {endereco}")

    conferir(url)
    caminho = destino or Path(tempfile.mkstemp(suffix=".xlsx", prefix="iluminacao-")[1])
    try:
        with requests.get(
            url, stream=True, timeout=TIMEOUT_S, headers={"User-Agent": "iTree"}
        ) as resposta:
            resposta.raise_for_status()
            conferir(resposta.url)
            declarado = int(resposta.headers.get("Content-Length") or 0)
            if declarado > LIMITE_DOWNLOAD_BYTES:
                raise ErroPlanilha("O arquivo passa do limite de tamanho do download.")
            total = 0
            with open(caminho, "wb") as saida:
                for pedaco in resposta.iter_content(chunk_size=1024 * 256):
                    total += len(pedaco)
                    if total > LIMITE_DOWNLOAD_BYTES:
                        raise ErroPlanilha("O arquivo passa do limite de tamanho do download.")
                    saida.write(pedaco)
    except (requests.RequestException, ValueError) as exc:
        caminho.unlink(missing_ok=True)
        raise ErroPlanilha(f"Falha ao baixar {url}: {exc}") from exc
    except ErroPlanilha:
        caminho.unlink(missing_ok=True)
        raise
    return caminho


def _sha256(caminho: Path) -> str:
    resumo = hashlib.sha256()
    with open(caminho, "rb") as f:
        for pedaco in iter(lambda: f.read(1024 * 1024), b""):
            resumo.update(pedaco)
    return resumo.hexdigest()


def importar(
    caminho: Path,
    *,
    fonte_url: str = URL_OFICIAL,
    data_referencia: date | None = DATA_REFERENCIA,
) -> LoteIluminacao:
    """Lê o XLSX e troca todos os pontos pelos do arquivo, numa única transação.

    Se qualquer passo falhar, nada muda: os pontos anteriores continuam. Descarta (e conta) o
    ponto sem coordenada, com coordenada ilegível ou fora da faixa e o que cai fora do município.
    """
    leitura = agregar(abrir_linhas(caminho))
    transformacao = CoordTransform(SpatialReference(SRID_METRICO), SpatialReference(4326))
    municipio = LimiteDoMunicipio()
    resolvedor = ResolvedorDeBairro()
    sem_coordenada = invalidas = fora = 0
    validos: list[tuple[PontoLido, Point, int | None]] = []
    for ponto in leitura.pontos.values():
        if ponto.coordenada_invalida:
            invalidas += 1
            continue
        if ponto.x is None:
            sem_coordenada += 1
            continue
        geom = Point(ponto.x, ponto.y, srid=SRID_METRICO)
        geom.transform(transformacao)
        if not municipio.contem(geom):
            fora += 1
            continue
        validos.append((ponto, geom, resolvedor.id_do_ponto(geom)))

    with transaction.atomic():
        lote = LoteIluminacao.objects.create(
            fonte=FONTE,
            fonte_url=fonte_url,
            licenca=LICENCA,
            data_referencia=data_referencia,
            ingerido_em=timezone.now(),
            arquivo_sha256=_sha256(caminho),
            linhas_lidas=leitura.linhas,
            pontos_importados=len(validos),
            sem_coordenada=sem_coordenada,
            coordenada_invalida=invalidas,
            fora_do_municipio=fora,
            sem_codigo=leitura.sem_codigo,
            metadados={"src_original": f"EPSG:{SRID_METRICO} (SIRGAS 2000 / UTM 24S)"},
        )
        PontoIluminacao.objects.all()._raw_delete(PontoIluminacao.objects.db)
        PontoIluminacao.objects.bulk_create(
            (
                PontoIluminacao(
                    codigo=p.codigo,
                    geom=geom,
                    regional=p.regional,
                    bairro_fonte=p.bairro,
                    bairro_id=bairro_id,
                    logradouro=p.logradouro,
                    poste_tipo=p.poste_tipo,
                    altura_poste_min_m=p.altura_min,
                    altura_poste_max_m=p.altura_max,
                    lampadas=p.lampadas,
                    lote=lote,
                )
                for p, geom, bairro_id in validos
            ),
            batch_size=LOTE_BULK,
        )
    return lote
