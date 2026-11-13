"""Leitura dos arquivos de importação de inventário (RF-INV-010 e RF-INV-015).

Formatos tabulares (CSV e XLSX) e geográficos (GeoJSON, Shapefile em ZIP, GeoPackage, KML e KMZ).
Os geográficos passam pela GDAL/OGR do GeoDjango a partir de um diretório temporário próprio,
criado só para a leitura e apagado em seguida: o nome dos arquivos é fixo (nenhum caminho vem
do usuário), o ZIP só extrai membros de extensões conhecidas, sem diretórios, com limite de
membros e de tamanho descompactado.
"""

import csv
import io
import json
import logging
import tempfile
import zipfile
from datetime import date, datetime
from pathlib import Path, PurePosixPath

from django.conf import settings
from django.contrib.gis.gdal import DataSource, GDALException, SpatialReference
from django.contrib.gis.gdal.error import SRSException

logger = logging.getLogger(__name__)

LIMITE_LINHAS = 20_000

FORMATOS_POR_EXTENSAO = {
    ".csv": "csv",
    ".txt": "csv",
    ".geojson": "geojson",
    ".json": "geojson",
    ".xlsx": "xlsx",
    ".zip": "shapefile",
    ".gpkg": "geopackage",
    ".kml": "kml",
    ".kmz": "kmz",
}
FORMATOS_TABULARES = ("csv", "xlsx")
EXTENSOES_ACEITAS = ", ".join(sorted(FORMATOS_POR_EXTENSAO))

# Extensões que o Shapefile em ZIP pode trazer; os demais membros são ignorados.
_EXTENSOES_SHAPEFILE = (".shp", ".shx", ".dbf", ".prj", ".cpg")
_DRIVERS_ACEITOS = {"ESRI Shapefile", "GPKG", "KML", "LIBKML"}
_ASSINATURA_SQLITE = b"SQLite format 3\x00"


class ErroArquivo(Exception):
    pass


def formato_do_arquivo(nome: str) -> str | None:
    return FORMATOS_POR_EXTENSAO.get(PurePosixPath(nome.lower()).suffix)


def _mb(valor: int) -> int:
    return valor * 1024 * 1024


def validar_tamanho(tamanho: int) -> None:
    limite = settings.IMPORTACAO_TAMANHO_MAXIMO_MB
    if tamanho > _mb(limite):
        raise ErroArquivo(f"O arquivo passa do limite de {limite} MB.")


def _decodificar(conteudo: bytes) -> str:
    for codificacao in ("utf-8-sig", "latin-1"):
        try:
            return conteudo.decode(codificacao)
        except UnicodeDecodeError:
            continue
    raise ErroArquivo("Não foi possível ler o arquivo como texto (UTF-8 ou Latin-1).")


def _abrir_zip(conteudo: bytes) -> zipfile.ZipFile:
    try:
        arquivo = zipfile.ZipFile(io.BytesIO(conteudo))
    except zipfile.BadZipFile as exc:
        raise ErroArquivo("O arquivo não é um ZIP válido.") from exc
    membros = [i for i in arquivo.infolist() if not i.is_dir()]
    if len(membros) > settings.IMPORTACAO_MAX_MEMBROS_ZIP:
        raise ErroArquivo(
            f"O ZIP tem {len(membros)} arquivos; o limite é {settings.IMPORTACAO_MAX_MEMBROS_ZIP}."
        )
    if sum(i.file_size for i in membros) > _mb(settings.IMPORTACAO_MAX_DESCOMPACTADO_MB):
        raise ErroArquivo(
            f"O conteúdo descompactado passa do limite de "
            f"{settings.IMPORTACAO_MAX_DESCOMPACTADO_MB} MB."
        )
    return arquivo


def _membro_util(info: zipfile.ZipInfo) -> bool:
    partes = PurePosixPath(info.filename).parts
    return not info.is_dir() and "__MACOSX" not in partes and not partes[-1].startswith(".")


def _extrair(arquivo: zipfile.ZipFile, info: zipfile.ZipInfo, destino: Path) -> None:
    """Grava o membro em ``destino`` (nome escolhido por nós); ``ZipExtFile`` não lê além do
    tamanho declarado, que já passou pelo limite."""
    with arquivo.open(info) as origem, destino.open("wb") as saida:
        while pedaco := origem.read(1024 * 1024):
            saida.write(pedaco)


def _valor_simples(valor):
    if valor is None or isinstance(valor, int | float | str | bool):
        return valor
    if isinstance(valor, datetime | date):
        return valor.isoformat()
    return str(valor)


def _ler_ogr(caminho: Path, srid: int, ponto_interior: bool) -> tuple[list[str], list[dict]]:
    try:
        fonte = DataSource(str(caminho))
    except GDALException as exc:
        raise ErroArquivo("Não foi possível abrir o arquivo geográfico.") from exc
    if fonte.driver.name not in _DRIVERS_ACEITOS:
        raise ErroArquivo("Formato geográfico não suportado.")
    camadas = [c for c in fonte if len(c) > 0]
    if not camadas:
        raise ErroArquivo("O arquivo não tem nenhuma feição.")
    if len(camadas) > 1:
        nomes = ", ".join(c.name for c in camadas[:5])
        raise ErroArquivo(
            f"O arquivo tem {len(camadas)} camadas com feições ({nomes}). "
            "Deixe só a camada das árvores e envie de novo."
        )
    camada = camadas[0]
    if len(camada) > LIMITE_LINHAS:
        raise ErroArquivo(f"O arquivo tem {len(camada)} linhas; o limite é {LIMITE_LINHAS}.")
    # SRC do próprio arquivo; sem ele (Shapefile sem .prj), vale o informado.
    srs_arquivo = camada.srs
    colunas = list(camada.fields)
    registros = []
    for feicao in camada:
        registro = {}
        for nome in colunas:
            try:
                registro[nome] = _valor_simples(feicao.get(nome))
            except (GDALException, ValueError, UnicodeDecodeError):
                registro[nome] = None
        registro.update(_coordenadas(feicao, srs_arquivo, srid, ponto_interior))
        registros.append(registro)
    return colunas, registros


def _coordenadas(feicao, srs_arquivo, srid: int, ponto_interior: bool) -> dict:
    """Ponto em 4326 da feição. Polígonos e linhas só entram se o ponto interior foi pedido."""
    try:
        geom = feicao.geom
    except GDALException:
        return {}
    if geom is None or geom.empty:
        return {}
    try:
        if srs_arquivo is None:
            geom.srs = SpatialReference(srid)
        geom.transform(4326)
        geos = geom.geos
    except (GDALException, SRSException, ValueError):
        return {"__erro_geometria": "Não foi possível converter a geometria para WGS 84."}
    tipo = geos.geom_type
    if tipo == "MultiPoint" and len(geos) == 1:
        geos, tipo = geos[0], "Point"
    if tipo == "Point":
        return {"__lon": geos.x, "__lat": geos.y, "__srid": 4326}
    rotulo = {
        "Polygon": "polígono",
        "MultiPolygon": "polígono",
        "LineString": "linha",
        "MultiLineString": "linha",
        "MultiPoint": "conjunto de pontos",
    }.get(tipo, tipo)
    if ponto_interior and tipo in ("Polygon", "MultiPolygon"):
        interior = geos.point_on_surface
        return {"__lon": interior.x, "__lat": interior.y, "__srid": 4326}
    dica = (
        " Marque a opção de usar o ponto interior dos polígonos para aceitá-los."
        if tipo in ("Polygon", "MultiPolygon")
        else ""
    )
    return {"__erro_geometria": f"Geometria do tipo {rotulo}: só pontos são importados.{dica}"}


def _ler_geografico(
    conteudo: bytes, formato: str, srid: int, ponto_interior: bool
) -> tuple[list[str], list[dict]]:
    with tempfile.TemporaryDirectory(prefix="itree-importacao-") as pasta:
        base = Path(pasta)
        if formato == "geopackage":
            if not conteudo.startswith(_ASSINATURA_SQLITE):
                raise ErroArquivo("O arquivo não é um GeoPackage válido.")
            alvo = base / "dados.gpkg"
            alvo.write_bytes(conteudo)
        elif formato == "kml":
            alvo = base / "dados.kml"
            alvo.write_bytes(conteudo)
        elif formato == "kmz":
            with _abrir_zip(conteudo) as zip_:
                kmls = [
                    i for i in zip_.infolist() if _membro_util(i) and i.filename.endswith(".kml")
                ]
                if not kmls:
                    raise ErroArquivo("O KMZ não contém nenhum arquivo .kml.")
                preferido = next((i for i in kmls if i.filename == "doc.kml"), kmls[0])
                alvo = base / "dados.kml"
                _extrair(zip_, preferido, alvo)
        else:  # shapefile
            with _abrir_zip(conteudo) as zip_:
                por_extensao = {}
                for info in zip_.infolist():
                    ext = PurePosixPath(info.filename.lower()).suffix
                    if _membro_util(info) and ext in _EXTENSOES_SHAPEFILE:
                        por_extensao.setdefault(ext, info)
                if ".shp" not in por_extensao:
                    raise ErroArquivo("O ZIP não contém um Shapefile (.shp).")
                for ext, info in por_extensao.items():
                    _extrair(zip_, info, base / f"camada{ext}")
            alvo = base / "camada.shp"
        return _ler_ogr(alvo, srid, ponto_interior)


def _ler_xlsx(conteudo: bytes) -> tuple[list[str], list[dict]]:
    from openpyxl import load_workbook

    with _abrir_zip(conteudo):  # confere o limite de membros e de tamanho descompactado
        pass
    try:
        pasta = load_workbook(io.BytesIO(conteudo), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001 - openpyxl levanta vários tipos para arquivo ruim
        raise ErroArquivo("Não foi possível ler a planilha XLSX.") from exc
    try:
        linhas = pasta.active.iter_rows(values_only=True)
        cabecalho = next(linhas, None)
        if not cabecalho or not any(c is not None and str(c).strip() for c in cabecalho):
            raise ErroArquivo("A primeira linha da planilha precisa ter os nomes das colunas.")
        colunas: list[str] = []
        for i, c in enumerate(cabecalho, start=1):
            nome = str(c).strip() if c is not None and str(c).strip() else f"coluna {i}"
            while nome in colunas:
                nome += "_"
            colunas.append(nome)
        registros = []
        for valores in linhas:
            if all(v is None or str(v).strip() == "" for v in valores):
                continue
            registros.append({c: _valor_simples(v) for c, v in zip(colunas, valores, strict=False)})
            if len(registros) > LIMITE_LINHAS:
                raise ErroArquivo(f"A planilha passa do limite de {LIMITE_LINHAS} linhas.")
        return colunas, registros
    finally:
        pasta.close()


def ler_registros(
    conteudo: bytes, formato: str, srid: int = 4326, ponto_interior: bool = False
) -> tuple[list[str], list[dict]]:
    """Devolve (colunas, registros). Nos formatos geográficos, a geometria vira ``__lon``/``__lat``
    (já em 4326, a partir do SRC do arquivo ou do ``srid`` informado quando o arquivo não tem)."""
    if formato == "xlsx":
        return _ler_xlsx(conteudo)
    if formato in ("shapefile", "geopackage", "kml", "kmz"):
        return _ler_geografico(conteudo, formato, srid, ponto_interior)
    texto = _decodificar(conteudo)
    if formato == "csv":
        try:
            dialeto = csv.Sniffer().sniff(texto[:4096], delimiters=",;\t")
        except csv.Error:
            dialeto = csv.excel
        leitor = csv.DictReader(io.StringIO(texto), dialect=dialeto)
        registros = [dict(r) for r in leitor]
        return list(leitor.fieldnames or []), registros
    if formato == "geojson":
        try:
            dados = json.loads(texto)
        except json.JSONDecodeError as exc:
            raise ErroArquivo(f"GeoJSON inválido: {exc.msg} (linha {exc.lineno}).") from exc
        feicoes = dados.get("features") if isinstance(dados, dict) else None
        if not isinstance(feicoes, list):
            raise ErroArquivo("O GeoJSON precisa ser uma FeatureCollection.")
        registros, colunas = [], []
        for feicao in feicoes:
            props = dict(feicao.get("properties") or {})
            geom = feicao.get("geometry") or {}
            if geom.get("type") == "Point" and len(geom.get("coordinates") or []) >= 2:
                props["__lon"], props["__lat"] = geom["coordinates"][:2]
            for chave in props:
                if chave not in colunas and not chave.startswith("__"):
                    colunas.append(chave)
            registros.append(props)
        return colunas, registros
    raise ErroArquivo(f"Formato não suportado. Use {EXTENSOES_ACEITAS}.")
