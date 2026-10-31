"""Identificadores UUIDv7 (RFC 9562): ordenáveis por tempo e geráveis no
cliente, para permitir criação offline e retentativas idempotentes (ADR-0001)."""

import os
import time
import uuid


def uuid7() -> uuid.UUID:
    ms = time.time_ns() // 1_000_000
    aleatorio = int.from_bytes(os.urandom(10), "big")
    valor = (ms & 0xFFFF_FFFF_FFFF) << 80
    valor |= 0x7 << 76  # versão 7
    valor |= ((aleatorio >> 62) & 0xFFF) << 64  # rand_a (12 bits)
    valor |= 0b10 << 62  # variante RFC 9562
    valor |= aleatorio & ((1 << 62) - 1)  # rand_b (62 bits)
    return uuid.UUID(int=valor)
