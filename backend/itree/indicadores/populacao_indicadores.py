"""Indicadores por bairro derivados da população, da renda e do IDH (leitura).

A base é a população **oficial** do Censo; a estimativa do ano fica em segundo plano e é sempre
rotulada como estimativa iTree. "Árvores cadastradas por 1.000 habitantes" e "habitantes por árvore
cadastrada" contam só as árvores do inventário: indicadores complementares à regra 3-30-300 (DP-14,
decidida em 21/11/2026), com a ressalva do inventário parcial, nunca "índice oficial".
"""

import json
import statistics
from datetime import timedelta

from django.contrib.gis.db.models.functions import AsGeoJSON
from django.utils import timezone

from itree.contas.acesso import filtrar_por_escopo
from itree.contas.models import Usuario
from itree.imoveis import sefin_bairros as sefin
from itree.inventario.models import Arvore
from itree.territorio.models import TipoTerritorio

from . import contagem as cont
from . import imoveis_indicadores, instantaneos
from . import populacao as pop
from .externos import bairros_do_escopo
from .models import ExecucaoFonteExterna, IndicadorTerritorialExterno

POR_MIL = "arvores_por_mil_habitantes"
HAB_POR_ARVORE = "habitantes_por_arvore"

RESSALVA_INVENTARIO = (
    "Conta só as árvores cadastradas; enquanto o inventário não cobre o bairro, um valor baixo "
    "pode indicar falta de cadastro, não falta de árvores."
)
AVISO_PROVISORIO = (
    "Indicador complementar à regra 3-30-300 (metodologia descrita, DP-14 decidida em "
    "21/11/2026). Provisório só pelo inventário parcial; não é índice oficial."
)
DEFINICAO_POR_MIL = (
    "Árvores cadastradas (ativas, com localização e origem conhecida) para cada 1.000 habitantes "
    "do bairro, pela população do Censo. Habitantes por árvore é o inverso: população ÷ árvores. "
    + RESSALVA_INVENTARIO
    + " "
    + AVISO_PROVISORIO
)
METODO_POR_MIL = (
    "Árvores válidas do bairro × 1.000 ÷ população residente do Censo (oficial). A referência de "
    "Fortaleza soma árvores e população do escopo (não é a média dos bairros). A estimativa "
    "iTree do ano entra só como segunda leitura."
)
NOME_POR_MIL = "Árvores cadastradas por 1.000 habitantes"
NOME_DENSIDADE = "Densidade populacional"
HIPOTESE = (
    "Estimativa iTree, não dado oficial: população do Censo × razão entre a estimativa do "
    "município e a população do município no Censo; supõe crescimento uniforme entre os bairros."
)

_INDICADORES = [
    pop.POPULACAO_CENSO,
    pop.DOMICILIOS_CENSO,
    pop.DENSIDADE,
    pop.POPULACAO_ESTIMADA,
    pop.RENDA,
    pop.IDH,
    pop.IDH_EDUCACAO,
    pop.IDH_LONGEVIDADE,
    pop.IDH_RENDA,
]


def _numero(v):
    return float(v) if v is not None else None


def _arredondado(v, casas=2):
    return round(v, casas) if v is not None else None


def quadro(
    usuario: Usuario | None = None, so_bairro: int | None = None, contagem: str = cont.TODAS
) -> list[dict]:
    """Uma linha por bairro (do escopo de ``usuario``; todos se ``None``) com população, densidade,
    renda, IDH, árvores, indicadores imobiliários e a regra 3-30-300. Número fixo de consultas,
    qualquer que seja o volume de dados.

    ``arvores`` é a contagem escolhida (``contagem``); ``arvores_total`` e ``arvores_confirmadas``
    trazem as duas, e ``por_mil``, ``hab_por_arvore`` e o "3" da regra seguem a escolhida."""
    from itree.territorio.models import Territorio

    bairros = (
        bairros_do_escopo(usuario)
        if usuario is not None
        else Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO)
    )
    if so_bairro is not None:
        bairros = bairros.filter(pk=so_bairro)
    nomes = dict(bairros.values_list("pk", "nome"))
    por_bairro: dict[int, dict] = {pk: {} for pk in nomes}
    for ind, tid, valor, num, den in IndicadorTerritorialExterno.objects.filter(
        territorio_id__in=list(nomes), indicador__in=_INDICADORES
    ).values_list("indicador", "territorio_id", "valor", "numerador", "denominador"):
        por_bairro[tid][ind] = (valor, num, den)
    validas = instantaneos.arvores_validas(Arvore.objects.all())
    if usuario is not None:
        validas = filtrar_por_escopo(validas, usuario)
    arvores = cont.por_grupo(validas.filter(bairro_id__in=list(nomes)), "bairro_id")
    imoveis = imoveis_indicadores.colunas(list(nomes), contagem)
    linhas = []
    for pk, nome in sorted(nomes.items(), key=lambda x: x[1]):
        d = por_bairro[pk]
        populacao = d[pop.POPULACAO_CENSO][1] if pop.POPULACAO_CENSO in d else None
        total, confirmadas = arvores.get(pk, (0, 0))
        n = cont.escolher(total, confirmadas, contagem)
        dens = d.get(pop.DENSIDADE)
        linhas.append(
            {
                "id": pk,
                "nome": nome,
                "populacao": populacao,
                "domicilios": d[pop.DOMICILIOS_CENSO][1] if pop.DOMICILIOS_CENSO in d else None,
                "densidade": _numero(dens[0]) if dens else None,
                "area_m2": dens[2] if dens else None,
                "estimada": d[pop.POPULACAO_ESTIMADA][1] if pop.POPULACAO_ESTIMADA in d else None,
                "arvores": n,
                "arvores_total": total,
                "arvores_confirmadas": confirmadas,
                "por_mil": _arredondado(1000 * n / populacao) if populacao else None,
                "hab_por_arvore": _arredondado(populacao / n, 1) if populacao and n else None,
                "renda": _numero(d[pop.RENDA][0]) if pop.RENDA in d else None,
                "idh": _numero(d[pop.IDH][0]) if pop.IDH in d else None,
                "idh_educacao": _numero(d[pop.IDH_EDUCACAO][0]) if pop.IDH_EDUCACAO in d else None,
                "idh_longevidade": (
                    _numero(d[pop.IDH_LONGEVIDADE][0]) if pop.IDH_LONGEVIDADE in d else None
                ),
                "idh_renda": _numero(d[pop.IDH_RENDA][0]) if pop.IDH_RENDA in d else None,
                "responsaveis": d[pop.RENDA][1] if pop.RENDA in d else None,
                **{
                    k: imoveis[pk].get(k)
                    for k in (
                        "iptu_medio",
                        "iptu_inscricoes",
                        "area_residencial",
                        "area_comercial",
                        "r3",
                        "r30",
                        "r300",
                    )
                },
            }
        )
    return linhas


def resumo(linhas: list[dict]) -> dict:
    """Referência do conjunto de bairros: densidade e árvores por mil pela soma (nunca a média dos
    percentuais), renda pela média ponderada por responsáveis, IDH pela média simples."""
    com_pop = [x for x in linhas if x["populacao"]]
    populacao = sum(x["populacao"] for x in com_pop)
    area = sum(x["area_m2"] for x in com_pop if x["area_m2"])
    arvores = sum(x["arvores"] for x in com_pop)
    arvores_total = sum(x["arvores_total"] for x in com_pop)
    arvores_confirmadas = sum(x["arvores_confirmadas"] for x in com_pop)
    com_renda = [x for x in linhas if x["renda"] is not None and x["responsaveis"]]
    peso = sum(x["responsaveis"] for x in com_renda)
    com_idh = [x["idh"] for x in linhas if x["idh"] is not None]
    estimada = sum(x["estimada"] for x in com_pop if x["estimada"])
    return {
        "bairros_com_populacao": len(com_pop),
        "populacao": populacao or None,
        "media_por_bairro": populacao / len(com_pop) if com_pop else None,
        "densidade": populacao / (area / 1_000_000) if populacao and area else None,
        "arvores": arvores,
        "arvores_total": arvores_total,
        "arvores_confirmadas": arvores_confirmadas,
        "por_mil": 1000 * arvores / populacao if populacao else None,
        "hab_por_arvore": populacao / arvores if populacao and arvores else None,
        "estimada": estimada or None,
        "renda": sum(x["renda"] * x["responsaveis"] for x in com_renda) / peso if peso else None,
        "idh": sum(com_idh) / len(com_idh) if com_idh else None,
    }


def proveniencia(indicador: str) -> dict | None:
    """Fonte, licença, datas, versão, definição e método do indicador (uma vez por camada)."""
    linhas = IndicadorTerritorialExterno.objects.filter(indicador=indicador)
    m = linhas.first()
    if m is None:
        return None
    ingerido = max(linhas.values_list("ingerido_em", flat=True))
    return {
        "indicador": indicador,
        "fonte": m.fonte,
        "fonte_url": m.fonte_url,
        "licenca": m.licenca,
        "data_referencia": m.data_referencia,
        "ingerido_em": ingerido,
        "versao": m.versao,
        "definicao": m.definicao,
        "metodo": m.metodo,
    }


def estimativa_municipal() -> dict | None:
    m = pop.municipio()
    if m is None:
        return None
    e = IndicadorTerritorialExterno.objects.filter(
        territorio=m, indicador=pop.ESTIMATIVA_MUNICIPIO
    ).first()
    if e is None:
        return None
    return {
        "ano": e.data_referencia.year if e.data_referencia else None,
        "populacao": e.numerador,
        "versao": e.versao,
        "fonte": e.fonte,
        "data_referencia": e.data_referencia,
    }


def texto_estimativa(estimada: int | None) -> str:
    """Estimativa iTree do bairro com o método e a hipótese, como deve aparecer onde o número
    aparece. Vazio sem estimativa."""
    if not estimada:
        return ""
    e = estimativa_municipal()
    ano = f" para {e['ano']}" if e and e["ano"] else ""
    return (
        f"Estimativa iTree{ano}: cerca de {estimada:,} pessoas".replace(",", ".")
        + " (não é dado oficial: Censo × razão entre a estimativa do município e o Censo, "
        + "supondo crescimento uniforme entre os bairros)."
    )


# --- Classes da camada coroplética (quantis da distribuição real) --------------------------------

CAMPOS_MAPA = {
    "densidade": ("densidade", pop.DENSIDADE, "Densidade populacional", "hab/km²", False),
    "arvores_por_mil": ("por_mil", POR_MIL, NOME_POR_MIL, "por 1.000 hab.", True),
    "renda": ("renda", pop.RENDA, pop.NOME_RENDA, "R$", False),
    "idh": ("idh", pop.IDH, pop.NOME_IDH, "IDH", False),
    "iptu_medio": ("iptu_medio", sefin.IPTU_MEDIO, sefin.NOMES[sefin.IPTU_MEDIO], "R$", False),
    "iptu_inscricoes": (
        "iptu_inscricoes",
        sefin.IPTU_INSCRICOES,
        sefin.NOMES[sefin.IPTU_INSCRICOES],
        "inscrições",
        False,
    ),
    "area_residencial": (
        "area_residencial",
        sefin.AREA_RESIDENCIAL,
        sefin.NOMES[sefin.AREA_RESIDENCIAL],
        "m²",
        False,
    ),
    "area_comercial": (
        "area_comercial",
        sefin.AREA_COMERCIAL,
        sefin.NOMES[sefin.AREA_COMERCIAL],
        "m²",
        False,
    ),
    "regra_3": ("r3", "regra_3", imoveis_indicadores.NOMES_REGRA["regra_3"], "%", False),
    "regra_30": ("r30", "regra_30", imoveis_indicadores.NOMES_REGRA["regra_30"], "%", False),
    "regra_300": ("r300", "regra_300", imoveis_indicadores.NOMES_REGRA["regra_300"], "%", False),
}


def quebras_quantis(valores: list[float], classes: int = 5) -> list[float]:
    """Limites inferiores das classes 2 a ``classes``: quantis da distribuição real. Valores
    repetidos nos limites são fundidos (menos classes, nunca classe vazia)."""
    v = sorted(x for x in valores if x is not None)
    if len(v) < classes:
        return []
    cortes = statistics.quantiles(v, n=classes, method="inclusive")
    saida: list[float] = []
    for c in cortes:
        c = round(c, 4)
        if (not saida or c > saida[-1]) and c > v[0]:
            saida.append(c)
    return saida


def geojson_populacao(usuario: Usuario, precisao: int = 5, contagem: str = cont.TODAS) -> dict:
    """Bairros do escopo com densidade, árvores por 1.000 habitantes, renda e IDH, mais as quebras
    por quantis (calculadas sobre todos os bairros de Fortaleza, para que a cor de um valor não
    mude conforme o escopo) e a proveniência de cada indicador."""
    do_escopo = quadro(usuario, contagem=contagem)
    todos = quadro(None, contagem=contagem) if usuario is not None else do_escopo
    geometrias = {
        pk: json.loads(g)
        for pk, g in bairros_do_escopo(usuario)
        .annotate(geometria=AsGeoJSON("geom", precision=precisao))
        .values_list("pk", "geometria")
    }
    feicoes = []
    for x in do_escopo:
        feicoes.append(
            {
                "type": "Feature",
                "id": str(x["id"]),
                "geometry": geometrias[x["id"]],
                "properties": {
                    "id": str(x["id"]),
                    "nome": x["nome"],
                    "densidade": x["densidade"],
                    "arvores_por_mil": x["por_mil"],
                    "renda": x["renda"],
                    "idh": x["idh"],
                    "populacao": x["populacao"],
                    "arvores": x["arvores"],
                    "arvores_total": x["arvores_total"],
                    "arvores_confirmadas": x["arvores_confirmadas"],
                    "estimada": x["estimada"],
                    **{
                        k: x[k]
                        for k in (
                            "iptu_medio",
                            "iptu_inscricoes",
                            "area_residencial",
                            "area_comercial",
                            "r3",
                            "r30",
                            "r300",
                        )
                    },
                },
            }
        )
    indicadores = []
    for id_, (chave, indicador, nome, unidade, provisorio) in CAMPOS_MAPA.items():
        if indicador.startswith("regra_"):
            prov = imoveis_indicadores.proveniencia_regra(indicador[6:], contagem)
        elif indicador == POR_MIL:
            prov = proveniencia(pop.POPULACAO_CENSO)
        else:
            prov = proveniencia(indicador)
        indicadores.append(
            {
                "id": id_,
                "nome": nome,
                "unidade": unidade,
                "provisorio": provisorio,
                "ressalva": RESSALVA_INVENTARIO if provisorio else "",
                "aviso": AVISO_PROVISORIO if provisorio else "",
                "quebras": quebras_quantis([x[chave] for x in todos]),
                "bairros_com_dado": sum(1 for x in do_escopo if x[chave] is not None),
                "proveniencia": prov,
            }
        )
    estim = estimativa_municipal()
    return {
        "type": "FeatureCollection",
        "features": feicoes,
        "indicadores": indicadores,
        "estimativa": {**estim, "hipotese": HIPOTESE} if estim else None,
    }


# --- Cartões da ficha do bairro ------------------------------------------------------------------


def _escala(todos: list[dict], chave: str) -> dict | None:
    v = [x[chave] for x in todos if x[chave] is not None]
    return {"min": min(v), "max": max(v)} if len(v) > 1 else None


def cartoes_ficha(
    bairro, usuario: Usuario, cartao, rotulo_cidade: str, contagem: str = cont.TODAS
) -> list[dict]:
    """Cartões de população, densidade, árvores por 1.000 habitantes, renda e IDH. ``cartao`` é o
    construtor de cartões da ficha."""
    linhas = quadro(usuario, contagem=contagem)
    x = next((r for r in linhas if r["id"] == bairro.pk), None)
    ref = resumo(linhas)
    sem = x is None

    def com(prov_id, **extra):
        p = proveniencia(prov_id) or {}
        return {
            "fonte": p.get("fonte", pop.ORGAO_IBGE),
            "fonte_url": p.get("fonte_url", ""),
            "licenca": p.get("licenca", ""),
            "data_referencia": p.get("data_referencia"),
            "definicao": p.get("definicao", ""),
            "metodo": p.get("metodo", ""),
            **extra,
        }

    cidade = lambda v: {"valor": v, "rotulo": rotulo_cidade} if v is not None else None  # noqa: E731
    cartoes = []
    populacao = None if sem else x["populacao"]
    cartoes.append(
        cartao(
            "populacao",
            pop.NOME_POPULACAO,
            valor=populacao,
            unidade="pessoas",
            sem_dado=populacao is None,
            nota="O Censo não tem a população deste bairro importada."
            if populacao is None
            else texto_estimativa(x["estimada"]),
            detalhe=f"{x['domicilios']:,} domicílios".replace(",", ".")
            if populacao and x["domicilios"]
            else "",
            cidade={"valor": ref["media_por_bairro"], "rotulo": "Média por bairro"}
            if ref["media_por_bairro"]
            else None,
            escala=_escala(linhas, "populacao"),
            **com(pop.POPULACAO_CENSO),
        )
    )
    densidade = None if sem else x["densidade"]
    cartoes.append(
        cartao(
            "densidade",
            NOME_DENSIDADE,
            valor=densidade,
            unidade="hab/km²",
            sem_dado=densidade is None,
            nota="Sem população do Censo ou sem área do polígono do bairro."
            if densidade is None
            else "Área do polígono oficial do bairro, em SIRGAS 2000 / UTM 24S.",
            detalhe=f"{x['area_m2'] / 1_000_000:,.2f} km²".replace(".", ",")
            if densidade and x["area_m2"]
            else "",
            cidade=cidade(ref["densidade"]),
            escala=_escala(linhas, "densidade"),
            **com(pop.DENSIDADE),
        )
    )
    por_mil = None if sem else x["por_mil"]
    detalhe = ""
    if por_mil is not None:
        hab = x["hab_por_arvore"]
        detalhe = f"{cont.rotulo(x['arvores_total'], x['arvores_confirmadas'])} · " + (
            f"{hab:,.1f} habitantes por árvore".replace(".", ",") if hab else "nenhuma árvore"
        )
    cartoes.append(
        cartao(
            "arvores_por_mil",
            NOME_POR_MIL,
            valor=por_mil,
            unidade="por 1.000 hab.",
            sem_dado=por_mil is None,
            provisorio=True,
            nota="Sem população do Censo para dividir." if por_mil is None else RESSALVA_INVENTARIO,
            detalhe=detalhe,
            cidade=cidade(ref["por_mil"]),
            escala=_escala(linhas, "por_mil"),
            **{
                **com(pop.POPULACAO_CENSO),
                "definicao": DEFINICAO_POR_MIL,
                "metodo": METODO_POR_MIL,
            },
        )
    )
    renda = None if sem else x["renda"]
    cartoes.append(
        cartao(
            "renda",
            pop.NOME_RENDA,
            valor=renda,
            unidade="R$",
            sem_dado=renda is None,
            nota="O Censo não tem rendimento para este bairro (omitido ou sem casamento)."
            if renda is None
            else "Rendimento do responsável pelo domicílio, em R$ de 2022; não é renda per capita.",
            cidade=cidade(ref["renda"]),
            escala=_escala(linhas, "renda"),
            **com(pop.RENDA),
        )
    )
    idh = None if sem else x["idh"]
    cartoes.append(
        cartao(
            "idh",
            pop.NOME_IDH,
            valor=idh,
            unidade="IDH",
            sem_dado=idh is None,
            nota=(
                "Sem IDH 2010 para este bairro: não existia com este nome nos limites da época."
                if idh is None
                else f"IDH de 2010 (base no Censo 2010), faixa {pop.faixa_idh(idh)}. Dado "
                "antigo, não é atual; limites de bairro da época podem diferir dos atuais."
            ),
            detalhe=(
                f"Educação {x['idh_educacao']:.3f} · longevidade {x['idh_longevidade']:.3f} · "
                f"renda {x['idh_renda']:.3f}".replace(".", ",")
                if idh is not None
                else ""
            ),
            cidade={"valor": ref["idh"], "rotulo": "Média dos bairros com IDH"}
            if ref["idh"] is not None
            else None,
            escala=_escala(linhas, "idh"),
            **com(pop.IDH),
        )
    )
    return cartoes


# --- Análises ------------------------------------------------------------------------------------


def _br(valor, casas: int = 0) -> str:
    """Número no formato brasileiro: ponto nos milhares, vírgula nos decimais."""
    texto = f"{valor:,.{casas}f}"
    return texto.replace(",", "\0").replace(".", ",").replace("\0", ".")


def linhas_arvores_por_mil(usuario: Usuario, contagem: str = cont.TODAS) -> list[dict]:
    saida = []
    for x in quadro(usuario, contagem=contagem):
        if x["por_mil"] is None:
            continue
        hab = _br(x["hab_por_arvore"], 1) if x["hab_por_arvore"] else "—"
        saida.append(
            {
                "rotulo": x["nome"],
                "valor": x["por_mil"],
                "territorio_id": str(x["id"]),
                "detalhe": f"{cont.rotulo(x['arvores_total'], x['arvores_confirmadas'])} · "
                f"{_br(x['populacao'])} habitantes (Censo) · {hab} hab. por árvore",
                "arvores": x["arvores"],
                "arvores_total": x["arvores_total"],
                "arvores_confirmadas": x["arvores_confirmadas"],
                "populacao": x["populacao"],
                "habitantes_por_arvore": x["hab_por_arvore"],
            }
        )
    return sorted(saida, key=lambda r: (-r["valor"], r["rotulo"]))


def linhas_populacao(usuario: Usuario) -> list[dict]:
    saida = []
    for x in quadro(usuario):
        if x["populacao"] is None:
            continue
        partes = []
        if x["densidade"] is not None:
            partes.append(f"{x['densidade']:,.0f} hab/km²".replace(",", "."))
        if x["area_m2"]:
            partes.append(f"{x['area_m2'] / 1_000_000:,.2f} km²".replace(".", ","))
        if x["domicilios"]:
            partes.append(f"{x['domicilios']:,} domicílios".replace(",", "."))
        if x["estimada"]:
            partes.append(f"estimativa iTree: {x['estimada']:,} (não oficial)".replace(",", "."))
        saida.append(
            {
                "rotulo": x["nome"],
                "valor": x["populacao"],
                "territorio_id": str(x["id"]),
                "detalhe": " · ".join(partes),
                "densidade": x["densidade"],
                "area_km2": _arredondado(x["area_m2"] / 1_000_000) if x["area_m2"] else None,
                "domicilios": x["domicilios"],
                "estimativa_itree": x["estimada"],
            }
        )
    return sorted(saida, key=lambda r: (-r["valor"], r["rotulo"]))


def dispersao_renda(usuario: Usuario, contagem: str = cont.TODAS) -> dict:
    """Árvores cadastradas por 1.000 habitantes × rendimento médio do responsável, por bairro.
    A correlação é só descrição (r e número de bairros); não afirma causa nem é índice oficial."""
    pontos = [
        {
            "id": str(x["id"]),
            "rotulo": x["nome"],
            "x": x["renda"],
            "y": x["por_mil"],
            "populacao": x["populacao"],
            "arvores": x["arvores"],
            "arvores_total": x["arvores_total"],
            "arvores_confirmadas": x["arvores_confirmadas"],
        }
        for x in quadro(usuario, contagem=contagem)
        if x["renda"] is not None and x["por_mil"] is not None
    ]
    r = None
    if len(pontos) >= 3 and len({p["x"] for p in pontos}) > 1 and len({p["y"] for p in pontos}) > 1:
        r = round(statistics.correlation([p["x"] for p in pontos], [p["y"] for p in pontos]), 2)
    return {
        "x_rotulo": "Rendimento médio do responsável (R$, Censo 2022)",
        "y_rotulo": "Árvores cadastradas por 1.000 habitantes (provisório)",
        "pontos": pontos,
        "correlacao": {
            "r": r,
            "bairros": len(pontos),
            "metodo": "Correlação linear de Pearson entre as duas colunas, sobre os bairros com os "
            "dois valores. É só uma descrição dos dados: não mede causa, não é índice oficial "
            "e o inventário é parcial.",
        },
    }


def linhas_dispersao(usuario: Usuario, contagem: str = cont.TODAS) -> list[dict]:
    d = dispersao_renda(usuario, contagem)
    saida = [
        {
            "rotulo": p["rotulo"],
            "valor": p["y"],
            "territorio_id": p["id"],
            "renda": p["x"],
            "detalhe": f"rendimento médio do responsável R$ {p['x']:,.0f}".replace(",", ".")
            + f" · {cont.rotulo(p['arvores_total'], p['arvores_confirmadas'])}",
        }
        for p in d["pontos"]
    ]
    return sorted(saida, key=lambda r: (-r["renda"], r["rotulo"]))


# --- Situação das fontes (Fontes dos dados e aviso de fonte desatualizada) ------------------------


def situacao_das_fontes(agora=None) -> list[dict]:
    """Uma entrada por fonte já executada: última conferência, versão em uso e se está
    desatualizada (sem conferência bem-sucedida há mais de ``IDADE_MAXIMA_DIAS``) ou com falha."""
    agora = agora or timezone.now()
    saida = []
    for fonte, nome in pop.FONTES.items():
        execucoes = ExecucaoFonteExterna.objects.filter(fonte=fonte)
        ultima = execucoes.first()
        if ultima is None:
            continue
        ok = execucoes.filter(sucesso=True).first()
        usada = execucoes.filter(sucesso=True, importou=True).first()
        desatualizada = ok is None or agora - ok.iniciada_em > timedelta(days=pop.IDADE_MAXIMA_DIAS)
        saida.append(
            {
                "fonte": fonte,
                "nome": nome,
                "versao": usada.versao if usada else "",
                "ano_referencia": usada.ano_referencia if usada else None,
                "importada_em": usada.concluida_em if usada else None,
                "ultima_conferencia": ultima.iniciada_em,
                "falhou": not ultima.sucesso,
                "erro": ultima.erro if not ultima.sucesso else "",
                "desatualizada": desatualizada,
                "limite_dias": pop.IDADE_MAXIMA_DIAS,
            }
        )
    return saida


def item_visao_geral(usuario: Usuario, bairro=None, contagem: str = cont.TODAS) -> dict | None:
    """Cartão discreto da visão geral: árvores cadastradas por 1.000 habitantes no escopo."""
    linhas = quadro(usuario, bairro.pk if bairro is not None else None, contagem)
    r = resumo(linhas)
    if r["por_mil"] is None:
        return None
    prov = proveniencia(pop.POPULACAO_CENSO) or {}
    return {
        "id": POR_MIL,
        "nome": NOME_POR_MIL + " (provisório)",
        "valor": round(r["por_mil"], 1),
        "numerador": r["arvores"],
        "arvores_total": r["arvores_total"],
        "arvores_confirmadas": r["arvores_confirmadas"],
        "contagem": contagem,
        "base": r["populacao"],
        "unidade": "por 1.000 hab.",
        "fonte": f"{prov.get('fonte', pop.ORGAO_IBGE)} (população) e inventário do iTree (árvores)",
        "fonte_url": prov.get("fonte_url", ""),
        "licenca": prov.get("licenca", ""),
        "data_referencia": prov.get("data_referencia"),
        "ingerido_em": prov.get("ingerido_em"),
        "definicao": DEFINICAO_POR_MIL,
        "metodo": METODO_POR_MIL,
        "bairros_com_dado": r["bairros_com_populacao"],
        "bairros_no_escopo": len(linhas),
    }
