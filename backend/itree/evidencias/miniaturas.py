"""Miniaturas das fotos: a grade da galeria não baixa o original (RF-FOTO-002)."""

import io
import logging

from PIL import Image, ImageOps, UnidentifiedImageError

from itree.core import armazenamento

from .models import Evidencia

logger = logging.getLogger(__name__)

LADO_MAXIMO = 480
QUALIDADE = 78
# Pillow lê estes formatos sem plugin; HEIC e PDF ficam sem miniatura (a grade usa o ícone).
TIPOS_COM_MINIATURA = {"image/jpeg", "image/png", "image/webp"}
# Evita descompressão de imagem gigante (bomba de pixels).
Image.MAX_IMAGE_PIXELS = 100_000_000


def chave_da_miniatura(chave: str) -> str:
    nome = chave.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return f"evidencias/miniaturas/{nome}.jpg"


def reduzir(conteudo: bytes) -> bytes:
    """JPEG de até ``LADO_MAXIMO`` px no maior lado, com a rotação EXIF aplicada."""
    with Image.open(io.BytesIO(conteudo)) as imagem:
        imagem = ImageOps.exif_transpose(imagem)
        imagem.thumbnail((LADO_MAXIMO, LADO_MAXIMO))
        if imagem.mode in ("RGBA", "LA", "P"):
            fundo = Image.new("RGB", imagem.size, "white")
            rgba = imagem.convert("RGBA")
            fundo.paste(rgba, mask=rgba.getchannel("A"))
            imagem = fundo
        else:
            imagem = imagem.convert("RGB")
        saida = io.BytesIO()
        imagem.save(saida, "JPEG", quality=QUALIDADE, optimize=True)
        return saida.getvalue()


def gerar_miniatura(evidencia: Evidencia) -> bool:
    """Gera e guarda a miniatura. Devolve False, sem levantar erro, se não for possível:
    a foto continua válida e a grade cai no original."""
    if evidencia.tipo_conteudo not in TIPOS_COM_MINIATURA or not armazenamento.s3_configurado():
        return False
    try:
        original = armazenamento.ler(evidencia.chave)
        chave = chave_da_miniatura(evidencia.chave)
        armazenamento.gravar(chave, reduzir(original), "image/jpeg")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError):
        logger.warning("Miniatura não gerada para a evidência %s", evidencia.pk, exc_info=True)
        return False
    except Exception:  # noqa: BLE001 - falha do armazenamento não impede a confirmação
        logger.warning(
            "Armazenamento falhou ao gerar a miniatura de %s", evidencia.pk, exc_info=True
        )
        return False
    evidencia.chave_miniatura = chave
    evidencia.save(update_fields=["chave_miniatura", "atualizado_em"])
    return True
