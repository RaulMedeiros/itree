"""Apoio dos testes da detecção automática: cargas, tokens, fotos e deslocamentos em metros."""

import io
import math

from PIL import Image

from itree.deteccao import servico

from .conftest import PONTO_A

LOTE_URL = "/api/v1/deteccoes/lotes"


def deslocar(ponto: dict, leste_m: float = 0.0, norte_m: float = 0.0) -> dict:
    lat = ponto["latitude"]
    return {
        "longitude": ponto["longitude"] + leste_m / (111_320 * math.cos(math.radians(lat))),
        "latitude": lat + norte_m / 110_540,
    }


def lote(**extra) -> dict:
    return {
        "id": "lote-1",
        "projeto_origem": "deteccao-arvores",
        "versao_modelo": "v1.0",
        "sensor": "video_rua",
        "capturado_em": "2026-11-20",
        **extra,
    }


def det(ident="d1", local=None, **extra) -> dict:
    return {
        "id": ident,
        "tipo": "arvore",
        "localizacao": local or dict(PONTO_A),
        "incerteza_m": 1.0,
        "confianca": 0.9,
        **extra,
    }


def corpo(deteccoes=None, **lote_extra) -> dict:
    return {"lote": lote(**lote_extra), "deteccoes": deteccoes if deteccoes is not None else [det()]}


def foto(arquivo="a.png", **extra) -> dict:
    return {"arquivo": arquivo, "capturada_em": "2026-11-20T10:00:00-03:00", "anonimizada": True, **extra}


def imagem(formato="PNG", lado=64) -> bytes:
    saida = io.BytesIO()
    Image.new("RGB", (lado, lado), "green").save(saida, formato)
    return saida.getvalue()


def com_token(cliente, territorios, admin, nome="Projeto de detecção"):
    token, valor = servico.criar_token(nome, territorios, admin)
    cliente.credentials(HTTP_AUTHORIZATION=f"Token {valor}")
    return token, valor
