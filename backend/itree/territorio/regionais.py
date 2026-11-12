"""Equivalência das regionais de Fortaleza entre o CKAN e o Fortaleza em Mapas (F-03).

As duas fontes numeram as 12 Secretarias Executivas Regionais (SER, desde a lei de
27/12/2019) de jeitos diferentes. Verificado com o dado real em 2026-11-12:

- O **número** da regional é o do Fortaleza em Mapas: "SER n", com n de 1 a 12 (``regiao_adm``
  do mapa 17; "Regional Atual" dos bairros, mapa 21). É o que o iTree grava como código da
  regional.
- O **nome** do polígono no CKAN (dataset ``regionais-atuais``, KMZ) é o mesmo número em
  romano: a SER 8 é ``VIII``. A área dos polígonos confirma (35,53 km² no CKAN, 35,55 km² no
  Mapas).
- O **código** (campo ``Regional`` do KMZ do CKAN, ``novas_regionais`` dos bairros do CKAN e
  "Código da  Região" dos bairros do Mapas) é outra numeração, também em romano, e **não**
  coincide com o número: a SER 8 tem o código ``VI`` e a SER 6, o código ``VIII``.
- O campo ``regional`` dos bairros no CKAN ("SER I" a "SER VI" e "SERCE") e "Regional Antiga"
  no Mapas são a divisão anterior a 2019, sem correspondência 1 a 1 com as 12 atuais.

A importação oficial (``importar_limites_fortaleza``) usa esta tabela para gravar o nome e o
código do CKAN em cada regional e para conferir, em cada bairro, o código informado pela
fonte contra a regional atual. Quem agregar dados do CKAN por regional (por exemplo, a coluna
"Regional" das podas da URBFOR, que usa o número) traduz com ``regional_por_codigo_ckan`` ou
``regional_por_numero``.
"""

import re
from dataclasses import dataclass

ROMANOS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]


@dataclass(frozen=True)
class Regional:
    numero: int  # "SER n" no Fortaleza em Mapas; é o código gravado em Territorio
    ckan_nome: str  # ``name`` do polígono no CKAN (o número em romano)
    codigo: str  # campo ``Regional`` do CKAN, ``novas_regionais`` e "Código da  Região" do Mapas

    @property
    def mapas_nome(self) -> str:
        return f"SER {self.numero}"


# número da regional -> código (romano) nos bairros e no campo ``Regional`` do KMZ do CKAN
_CODIGO_POR_NUMERO = {
    1: "II",
    2: "III",
    3: "IV",
    4: "V",
    5: "XII",
    6: "VIII",
    7: "VII",
    8: "VI",
    9: "IX",
    10: "X",
    11: "XI",
    12: "I",
}

EQUIVALENCIA: tuple[Regional, ...] = tuple(
    Regional(n, ROMANOS[n - 1], _CODIGO_POR_NUMERO[n]) for n in range(1, 13)
)
_POR_NUMERO = {r.numero: r for r in EQUIVALENCIA}
_POR_CODIGO = {r.codigo: r for r in EQUIVALENCIA}


def numero_da_regional(texto) -> int | None:
    """ "Secretaria Executiva Regional 8", "SER 08" ou "SER 8" -> 8; fora de 1 a 12, ``None``."""
    achado = re.search(r"(\d+)\s*$", str(texto or ""))
    numero = int(achado.group(1)) if achado else None
    return numero if numero in _POR_NUMERO else None


def regional_por_numero(numero) -> Regional | None:
    return _POR_NUMERO.get(numero if isinstance(numero, int) else numero_da_regional(numero))


def regional_por_codigo_ckan(codigo) -> Regional | None:
    """Regional pelo código em romano do CKAN ("VI" -> SER 8); ``None`` se desconhecido."""
    return _POR_CODIGO.get(str(codigo or "").strip().upper())
