"""Faixas do selo de confiança (limiares em settings, não no código)."""

from django.conf import settings


def faixa_de_confianca(confianca: float | None) -> str:
    """ "baixa" (< 0,5), "media" (de 0,5 a < 0,8) ou "alta" (>= 0,8); vazio sem confiança."""
    if confianca is None:
        return ""
    if confianca >= settings.DETECCAO_CONFIANCA_ALTA:
        return "alta"
    if confianca >= settings.DETECCAO_CONFIANCA_MEDIA:
        return "media"
    return "baixa"
