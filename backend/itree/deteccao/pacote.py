"""Leitura do pacote de detecções: ZIP com ``lote.json``, GeoJSON ou GeoPackage e as fotos.

Reaproveita ``inventario.leitura_arquivos``: o mesmo ZIP seguro (limite de membros e de tamanho
descompactado, sem extrair para caminho vindo do usuário) e a mesma leitura de GeoJSON e
GeoPackage, que passa pela GDAL num diretório temporário próprio. As fotos são lidas da memória, a
partir do nome declarado em cada foto (``arquivo``), nunca de um caminho do disco.
"""

import json
from dataclasses import dataclass
from pathlib import PurePosixPath

from django.conf import settings

from itree.inventario import leitura_arquivos
from itree.inventario.leitura_arquivos import ErroArquivo

from .contrato import ErroContrato, deteccao_de_registro

EXTENSOES_FOTO = {".jpg", ".jpeg", ".png", ".webp"}
NOME_LOTE = "lote.json"
NOMES_DETECCOES = {"deteccoes.geojson": "geojson", "deteccoes.gpkg": "geopackage"}


@dataclass
class Pacote:
    lote: dict
    deteccoes: list[dict]
    fotos: dict[str, "FotoDoPacote"]


class FotoDoPacote:
    """Foto ainda dentro do ZIP: o tamanho vem do cabeçalho e o conteúdo só é lido ao guardar."""

    def __init__(self, zip_, info):
        self._zip, self._info = zip_, info
        self.tamanho = info.file_size

    def ler(self) -> bytes:
        return self._zip.read(self._info)


def _chave(nome: str) -> str:
    return PurePosixPath(nome.replace("\\", "/")).as_posix().lstrip("./").lower()


def ler_pacote(conteudo: bytes) -> tuple[Pacote, "object"]:
    """(pacote, zip aberto). Quem chama fecha o ZIP depois de guardar as fotos."""
    if len(conteudo) > settings.DETECCAO_MAX_CORPO_MB * 1024 * 1024:
        raise ErroContrato(f"O pacote passa do limite de {settings.DETECCAO_MAX_CORPO_MB} MB.")
    zip_ = leitura_arquivos._abrir_zip(  # noqa: SLF001 - mesmas proteções da importação
        conteudo,
        max_membros=settings.DETECCAO_PACOTE_MAX_MEMBROS,
        max_descompactado_mb=settings.DETECCAO_MAX_CORPO_MB * 2,
    )
    try:
        membros = {
            _chave(i.filename): i
            for i in zip_.infolist()
            if leitura_arquivos._membro_util(i)  # noqa: SLF001
        }
        if NOME_LOTE not in membros:
            raise ErroContrato(f"O pacote precisa de um arquivo {NOME_LOTE} na raiz.")
        try:
            lote = json.loads(zip_.read(membros[NOME_LOTE]).decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ErroContrato(f"{NOME_LOTE}: JSON inválido.") from None
        presentes = [n for n in NOMES_DETECCOES if n in membros]
        if len(presentes) != 1:
            raise ErroContrato(
                "O pacote precisa de um, e só um, entre deteccoes.geojson e deteccoes.gpkg."
            )
        nome = presentes[0]
        conteudo_geo = zip_.read(membros[nome])
        try:
            _, registros = leitura_arquivos.ler_registros(conteudo_geo, NOMES_DETECCOES[nome])
        except ErroArquivo as exc:
            raise ErroContrato(f"{nome}: {exc}") from exc
        fotos = {
            n: FotoDoPacote(zip_, i)
            for n, i in membros.items()
            if PurePosixPath(n).suffix in EXTENSOES_FOTO
        }
        return Pacote(lote, [deteccao_de_registro(r) for r in registros], fotos), zip_
    except Exception:
        zip_.close()
        raise


def procurar_foto(fotos: dict, arquivo: str):
    """Foto pelo nome declarado: caminho completo ou só o nome do arquivo (sem ambiguidade)."""
    chave = _chave(arquivo)
    if chave in fotos:
        return fotos[chave]
    pelo_nome = [f for n, f in fotos.items() if PurePosixPath(n).name == PurePosixPath(chave).name]
    return pelo_nome[0] if len(pelo_nome) == 1 else None


class FotoEnviada:
    """Foto enviada em multipart: o tamanho vem do envio e o conteúdo só é lido ao guardar."""

    def __init__(self, arquivo):
        self._arquivo = arquivo
        self.tamanho = arquivo.size

    def ler(self) -> bytes:
        self._arquivo.seek(0)
        return self._arquivo.read()


def fotos_do_multipart(arquivos) -> dict[str, FotoEnviada]:
    """Fotos de um multipart, pelo nome do arquivo enviado (``arquivo`` na foto da detecção)."""
    return {_chave(a.name): FotoEnviada(a) for a in arquivos if a.name}
