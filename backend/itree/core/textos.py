"""Textos que chegam ao usuário final."""

import re

# Códigos internos das specs e das decisões: DP-11, RN-INV-001, RF-OCO-006...
CODIGO_INTERNO = re.compile(r"\b(?:DP|RN|RF|CA)-[A-Z0-9]+(?:-[A-Z0-9]+)*\b")


def sem_codigos_internos(texto: str) -> str:
    """Tira códigos internos de textos gravados antes da regra (R2-14).

    "(DP-11)" vira "(em definição pela prefeitura)", pois a decisão está pendente; os códigos
    de regra (RN, RF, CA) somem, com a pontuação que ficaria solta.
    """
    texto = re.sub(r"\(DP-[A-Z0-9]+\)", "(em definição pela prefeitura)", texto)
    texto = re.sub(r"\s*\((?:RN|RF|CA)-[A-Z0-9-]+\)", "", texto)
    texto = CODIGO_INTERNO.sub("", texto)
    texto = re.sub(r"\(\s*[,;]\s*", "(", texto)
    texto = re.sub(r"\s*\(\s*\)", "", texto)
    return re.sub(r"\s{2,}", " ", texto).strip()
