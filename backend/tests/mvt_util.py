"""Leitor mínimo de vector tiles (MVT) para os testes: camadas, propriedades e pontos.

Só o que os testes precisam: decodifica o protobuf do tile (camadas, chaves, valores e
geometria de pontos) sem dependência nova. As coordenadas voltam em graus (WGS 84), a partir
do tile XYZ.
"""

import math


def _varint(dados: bytes, i: int) -> tuple[int, int]:
    resultado = deslocamento = 0
    while True:
        b = dados[i]
        i += 1
        resultado |= (b & 0x7F) << deslocamento
        if not b & 0x80:
            return resultado, i
        deslocamento += 7


def _campos(dados: bytes):
    """(número do campo, valor) de uma mensagem protobuf; valor é int ou bytes."""
    i = 0
    while i < len(dados):
        chave, i = _varint(dados, i)
        numero, tipo = chave >> 3, chave & 7
        if tipo == 0:
            valor, i = _varint(dados, i)
        elif tipo == 2:
            tamanho, i = _varint(dados, i)
            valor, i = dados[i : i + tamanho], i + tamanho
        elif tipo == 1:
            valor, i = dados[i : i + 8], i + 8
        elif tipo == 5:
            valor, i = dados[i : i + 4], i + 4
        else:
            raise ValueError(f"Tipo protobuf {tipo} não tratado.")
        yield numero, valor


def _empacotados(dados: bytes) -> list[int]:
    i, saida = 0, []
    while i < len(dados):
        v, i = _varint(dados, i)
        saida.append(v)
    return saida


def _valor(dados: bytes):
    for numero, v in _campos(dados):
        if numero == 1:
            return v.decode()
        if numero in (4, 5):
            return v
        if numero == 6:
            return (v >> 1) ^ -(v & 1)
        if numero == 7:
            return bool(v)
    return None


def _graus(x: float, y: float, z: int, tx: int, ty: int, extensao: int) -> tuple[float, float]:
    n = 2**z
    lon = (tx + x / extensao) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + y / extensao) / n))))
    return lon, lat


def decodificar(tile: bytes, z: int, x: int, y: int) -> dict[str, list[dict]]:
    """Camada -> feições ``{"props": {...}, "ponto": (lon, lat) ou None}``."""
    camadas: dict[str, list[dict]] = {}
    for numero, camada in _campos(tile):
        if numero != 3:
            continue
        nome, chaves, valores, extensao, brutas = "", [], [], 4096, []
        for n, v in _campos(camada):
            if n == 1:
                nome = v.decode()
            elif n == 2:
                brutas.append(v)
            elif n == 3:
                chaves.append(v.decode())
            elif n == 4:
                valores.append(_valor(v))
            elif n == 5:
                extensao = v
        feicoes = []
        for bruta in brutas:
            tags, geometria = [], []
            for n, v in _campos(bruta):
                if n == 2:
                    tags = _empacotados(v)
                elif n == 4:
                    geometria = _empacotados(v)
            props = {chaves[tags[k]]: valores[tags[k + 1]] for k in range(0, len(tags), 2)}
            ponto = None
            if geometria and geometria[0] & 7 == 1:  # MoveTo: ponto
                dx = (geometria[1] >> 1) ^ -(geometria[1] & 1)
                dy = (geometria[2] >> 1) ^ -(geometria[2] & 1)
                ponto = _graus(dx, dy, z, x, y, extensao)
            feicoes.append({"props": props, "ponto": ponto})
        camadas.setdefault(nome, []).extend(feicoes)
    return camadas
