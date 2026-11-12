"""Subtipo das praças do Fortaleza em Mapas (mapa 99, URBFOR).

A camada "Praças de Fortaleza" mistura equipamentos de natureza diferente, e a
fonte não tem um campo para distingui-los (os campos são ``id``, ``nome``,
``nome_pop``, ``bairro``, ``cod_bairro``, ``area m2``, ``fonte``, ``anoref`` e
``epsg_codif``). O subtipo sai da **primeira palavra do nome oficial**, sem
distinguir caixa nem acento:

==================================  ===================
Nome começa com                     Subtipo
==================================  ===================
"Areninha" (ou o erro "Arenina")    ``areninha``
"Calçadão"                          ``calcadao``
"Rotatória"                         ``rotatoria``
"Sem Denominação Oficial"           ``sem_denominacao``
qualquer outro nome                 ``praca``
==================================  ===================

"Qualquer outro nome" inclui as "Praça ...", mas também "Largo", "Área Verde",
"Jardim", "Canteiro", "Polo" e "Triângulo": a camada é de praças e áreas verdes
urbanas, e esses equipamentos ficam como ``praca`` até a URBFOR dizer outra coisa.
O apelido (``nome_pop``) não entra na regra: "Sem Denominação Oficial" com apelido
"Praça da Rua 850" continua sem denominação, porque o nome oficial é a referência.

Validação contra o dado real (484 feições, 2026-11-11): 19 areninhas (18 escritas
"Areninha" e uma "Arenina Thauzer Parente", erro de digitação da fonte), 5 calçadões,
1 rotatória, 27 sem denominação e 432 praças.
"""

import re
import unicodedata

from .models import SubtipoAreaVerde


def _sem_acento(texto: str) -> str:
    return unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()


def subtipo_da_praca(nome: str) -> str:
    """Subtipo de uma praça a partir do nome oficial da fonte."""
    texto = " ".join(_sem_acento(nome or "").casefold().split())
    if re.match(r"aren(?:inh|in)a\b", texto):  # "areninha" e o erro de digitação "arenina"
        return SubtipoAreaVerde.ARENINHA
    if re.match(r"calcadao\b", texto):
        return SubtipoAreaVerde.CALCADAO
    if re.match(r"rotatoria\b", texto):
        return SubtipoAreaVerde.ROTATORIA
    if re.match(r"sem denominacao\b", texto):
        return SubtipoAreaVerde.SEM_DENOMINACAO
    return SubtipoAreaVerde.PRACA
