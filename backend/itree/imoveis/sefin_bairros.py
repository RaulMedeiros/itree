"""Indicadores imobiliários por bairro da SEFIN (via Fortaleza em Mapas): IPTU e área edificada.

Fontes (GeoJSON por bairro, 121 feições, todas verificadas em 21/11/2026):

- mapa 769, "Valor Lançado de IPTU Médio por Bairro, 2024": ``Média do valor do imposto devido``
  (R$ por inscrição), ``Total do valor do imposto devido``;
- mapa 771, "Inscrições de IPTU por Bairro, 2024": ``Quantidade de inscrições``;
- mapas 122 e 118, "Áreas Edificadas Residenciais e Comerciais em 2021": ``areas_2021`` (m²) e
  ``inscr_2021``.

O IPTU é o imposto lançado, não a renda nem o valor de mercado: bairro com isenção ou imóvel
público tem imposto baixo. A área edificada é a das inscrições do cadastro da SEFIN.
"""

import json
from datetime import date

from django.db import transaction
from django.utils import timezone

from itree.indicadores.manejo_urbfor import IndiceBairros
from itree.indicadores.models import IndicadorTerritorialExterno
from itree.territorio.models import Territorio, TipoTerritorio

URL_MAPA = "https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id="
ORGAO = "SEFIN, Prefeitura de Fortaleza (via Fortaleza em Mapas)"
LICENCA = "Termos da API do Fortaleza em Mapas: uso livre, com citação da fonte"

IPTU_MEDIO = "iptu_medio_2024"
IPTU_INSCRICOES = "iptu_inscricoes_2024"
AREA_RESIDENCIAL = "area_edificada_residencial_2021"
AREA_COMERCIAL = "area_edificada_comercial_2021"
INDICADORES = [IPTU_MEDIO, IPTU_INSCRICOES, AREA_RESIDENCIAL, AREA_COMERCIAL]

NOMES = {
    IPTU_MEDIO: "IPTU médio por inscrição (2024)",
    IPTU_INSCRICOES: "Inscrições de IPTU (2024)",
    AREA_RESIDENCIAL: "Área edificada residencial (2021)",
    AREA_COMERCIAL: "Área edificada comercial (2021)",
}

FONTES = {
    IPTU_MEDIO: {
        "mapa": 769,
        "nome": "Valor lançado de IPTU médio por bairro, 2024",
        "data": date(2024, 12, 31),
        "unidade": "R$",
        "definicao": (
            "Valor médio do imposto devido de IPTU por inscrição imobiliária do bairro, exercício "
            "de 2024 (R$). É o imposto lançado: não é renda, nem valor de mercado, e imóveis "
            "isentos ou públicos baixam a média."
        ),
        "metodo": (
            "Campo «Média do valor do imposto devido» do mapa 769 do Fortaleza em Mapas (SEFIN), "
            "casado ao bairro pelo nome. Numerador = total do imposto devido (R$); denominador = "
            "inscrições; a média da cidade é o total ÷ inscrições, não a média dos bairros."
        ),
    },
    IPTU_INSCRICOES: {
        "mapa": 771,
        "nome": "Inscrições de IPTU por bairro, 2024",
        "data": date(2024, 12, 31),
        "unidade": "inscrições",
        "definicao": (
            "Quantidade de inscrições imobiliárias (unidades cadastradas) do bairro no exercício "
            "de 2024. Inclui residências, comércios e terrenos."
        ),
        "metodo": (
            "Campo «Quantidade de inscrições» do mapa 771 (SEFIN), casado ao bairro pelo nome."
        ),
    },
    AREA_RESIDENCIAL: {
        "mapa": 122,
        "nome": "Áreas edificadas residenciais em 2021",
        "data": date(2021, 12, 31),
        "unidade": "m²",
        "definicao": (
            "Soma das áreas edificadas das inscrições de uso residencial do bairro em 2021 (m²), "
            "segundo o cadastro da SEFIN."
        ),
        "metodo": (
            "Campo «areas_2021» do mapa 122 (SEFIN), casado ao bairro pelo nome. Numerador = área "
            "(m²); denominador = inscrições residenciais (inscr_2021)."
        ),
    },
    AREA_COMERCIAL: {
        "mapa": 118,
        "nome": "Áreas edificadas comerciais em 2021",
        "data": date(2021, 12, 31),
        "unidade": "m²",
        "definicao": (
            "Soma das áreas edificadas das inscrições de uso comercial do bairro em 2021 (m²), "
            "segundo o cadastro da SEFIN."
        ),
        "metodo": (
            "Campo «areas_2021» do mapa 118 (SEFIN), casado ao bairro pelo nome. Numerador = área "
            "(m²); denominador = inscrições comerciais (inscr_2021)."
        ),
    },
}


class FonteInvalida(ValueError):
    pass


def _numero(valor):
    try:
        v = float(valor)
    except (TypeError, ValueError):
        return None
    return v if v == v and v >= 0 else None


def ler(conteudo: bytes, indicador: str) -> list[dict]:
    """Linhas {nome, valor, numerador, denominador} do GeoJSON de um indicador."""
    try:
        feicoes = json.loads(conteudo)["features"]
    except (ValueError, KeyError, TypeError) as exc:
        raise FonteInvalida("GeoJSON ilegível.") from exc
    if not isinstance(feicoes, list) or len(feicoes) > 1000:
        raise FonteInvalida("Número de feições inesperado.")
    linhas = []
    for f in feicoes:
        p = f.get("properties") or {}
        if indicador in (IPTU_MEDIO, IPTU_INSCRICOES):
            nome = p.get("Bairro")
            inscricoes = _numero(p.get("Quantidade de inscrições"))
            media = _numero(p.get("Média do valor do imposto devido"))
            total = _numero(p.get("Total do valor do imposto devido"))
            if not nome or inscricoes is None:
                continue
            if indicador == IPTU_INSCRICOES:
                linhas.append(
                    {
                        "nome": nome,
                        "valor": inscricoes,
                        "numerador": int(inscricoes),
                        "denominador": None,
                    }
                )
            elif media is not None and total is not None:
                linhas.append(
                    {
                        "nome": nome,
                        "valor": media,
                        "numerador": int(round(total)),
                        "denominador": int(inscricoes),
                    }
                )
        else:
            nome = p.get("bairro")
            area = _numero(p.get("areas_2021"))
            inscricoes = _numero(p.get("inscr_2021"))
            if not nome or area is None:
                continue
            linhas.append(
                {
                    "nome": nome,
                    "valor": area,
                    "numerador": int(round(area)),
                    "denominador": int(inscricoes) if inscricoes is not None else None,
                }
            )
    if not linhas:
        raise FonteInvalida("Nenhum bairro válido no arquivo.")
    return linhas


@transaction.atomic
def importar(indicador: str, conteudo: bytes, *, ingerido_em=None) -> dict:
    spec = FONTES[indicador]
    linhas = ler(conteudo, indicador)
    agora = ingerido_em or timezone.now()
    bairros = list(Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO))
    indice = IndiceBairros.de(bairros)
    casados: set = set()
    sem_casamento = []
    for linha in linhas:
        bairro = indice.procurar(str(linha["nome"]))
        if not isinstance(bairro, Territorio) or bairro.pk in casados:
            sem_casamento.append(linha["nome"])
            continue
        casados.add(bairro.pk)
        IndicadorTerritorialExterno.objects.update_or_create(
            territorio=bairro,
            indicador=indicador,
            defaults={
                "valor": round(linha["valor"], 4),
                "numerador": linha["numerador"],
                "denominador": linha["denominador"],
                "unidade": spec["unidade"],
                "fonte": f"{ORGAO}: {spec['nome']}",
                "fonte_url": f"{URL_MAPA}{spec['mapa']}",
                "licenca": LICENCA,
                "data_referencia": spec["data"],
                "ingerido_em": agora,
                "definicao": spec["definicao"],
                "metodo": spec["metodo"],
            },
        )
    IndicadorTerritorialExterno.objects.filter(indicador=indicador).exclude(
        territorio_id__in=casados
    ).delete()
    return {
        "indicador": indicador,
        "gravados": len(casados),
        "sem_casamento": sorted(sem_casamento),
        "bairros_sem_dado": sorted(b.nome for b in bairros if b.pk not in casados),
    }
