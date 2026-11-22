"""Imóveis e regra 3-30-300 nos indicadores por bairro: colunas do quadro, cartões da ficha, bloco
3-30-300 da ficha, zona do macrozoneamento e proveniência. Só leitura do que o cálculo gravou."""

from itree.imoveis import macrozoneamento
from itree.imoveis import sefin_bairros as sefin

from . import regra_3_30_300 as regra
from .models import IndicadorTerritorialExterno

REGRA_ID = {"3": "regra_3", "30": "regra_30", "300": "regra_300"}
NOMES_REGRA = {
    "regra_3": "Regra 3-30-300: 3 árvores a até 30 m",
    "regra_30": "Regra 3-30-300: cobertura vegetal",
    "regra_300": "Regra 3-30-300: área verde a até 300 m",
}
CHAVES_SEFIN = {
    sefin.IPTU_MEDIO: "iptu_medio",
    sefin.IPTU_INSCRICOES: "iptu_inscricoes",
    sefin.AREA_RESIDENCIAL: "area_residencial",
    sefin.AREA_COMERCIAL: "area_comercial",
}


def colunas(ids, contagem: str = regra.TODAS) -> dict:
    """Por bairro: indicadores SEFIN e as três partes da regra (percentuais), em duas consultas."""
    ids = list(ids)
    saida: dict = {pk: {} for pk in ids}
    for ind, tid, valor, num, den in IndicadorTerritorialExterno.objects.filter(
        territorio_id__in=ids, indicador__in=list(CHAVES_SEFIN)
    ).values_list("indicador", "territorio_id", "valor", "numerador", "denominador"):
        saida[tid][CHAVES_SEFIN[ind]] = float(valor) if valor is not None else None
        if ind == sefin.IPTU_MEDIO:
            saida[tid]["iptu_total"] = num
            saida[tid]["iptu_base"] = den
    for pk, r in regra.resultados(ids, contagem).items():
        partes = regra.partes_do_resultado(r)
        saida[pk].update(
            r3=partes["3"].pct,
            r30=partes["30"].pct,
            r300=partes["300"].pct,
            regra=r,
        )
    return saida


def proveniencia_regra(parte: str, contagem: str = regra.TODAS) -> dict | None:
    """Fonte, método e data do cálculo de uma parte da regra (``None`` sem cálculo)."""
    resultados = regra.resultados(None, contagem)
    if not resultados:
        return None
    r = next(iter(resultados.values()))
    fonte = {
        "3": "Inventário de árvores do iTree e edificações do Google Open Buildings v3 (CC BY 4.0)",
        "30": "UrbVerde (IAU-USP): NDVI de 10 m, 2021",
        "300": "Áreas verdes oficiais (Fortaleza em Mapas) e Google Open Buildings v3 (CC BY 4.0)",
    }[parte]
    return {
        "indicador": REGRA_ID[parte],
        "fonte": f"{fonte}. Método: {regra.FONTE_METODO}",
        "fonte_url": regra.FONTE_URL,
        "licenca": "Dados de fontes com licenças próprias; cálculo do iTree",
        "data_referencia": r.data,
        "ingerido_em": r.calculado_em,
        "versao": "",
        "definicao": regra.PARTES[parte]["descricao"],
        "metodo": regra.METODO,
    }


def _escala_regra(resultados: dict, parte: str):
    v = [
        regra.partes_do_resultado(r)[parte].pct
        for r in resultados.values()
        if regra.partes_do_resultado(r)[parte].pct is not None
    ]
    return v


def bloco_regra(bairro, usuario, contagem: str = regra.TODAS) -> dict:
    """Bloco "3-30-300" da ficha: três medidores com meta, valor do bairro, da cidade e selo."""
    if contagem not in regra.CONTAGENS:
        contagem = regra.TODAS
    todos = regra.resultados(None, contagem)
    r = todos.get(bairro.pk)
    cidade = regra.cidade(todos)
    metas = regra.metas()
    partes = []
    for id_, spec in regra.PARTES.items():
        p = regra.partes_do_resultado(r)[id_] if r else None
        pct = p.pct if p else None
        nota = ""
        if r is None:
            nota = "A regra 3-30-300 ainda não foi calculada para este bairro."
        elif id_ == "30" and pct is None:
            nota = (
                "Sem cobertura vegetal: o NDVI de 10 m da UrbVerde não cobre Fortaleza (ver "
                "método). Com copas detectadas ou outra fonte de NDVI, este valor aparece."
            )
        elif pct is None:
            nota = "O bairro não tem edificações na base do cálculo."
        elif id_ == "3":
            nota = regra.RESSALVA_INVENTARIO
        partes.append(
            {
                "id": id_,
                "nome": spec["nome"],
                "meta": spec["meta"],
                "meta_pct": metas[id_].get("pct") or metas[id_].get("pct_residencias"),
                "unidade": spec["unidade"],
                "valor": pct,
                "numerador": getattr(p, "numerador", None) if p else None,
                "denominador": getattr(p, "denominador", None) if p else None,
                "cidade": cidade[id_],
                "atende": regra.atende(id_, pct),
                "sem_dado": pct is None,
                "nota": nota,
                "definicao": spec["descricao"],
            }
        )
    meta = (r.metadados if r else {}) or {}
    return {
        "contagem": contagem,
        "calculado_em": r.calculado_em if r else None,
        "data": r.data if r else None,
        "base_edificacoes": r.base_edificacoes if r else "",
        "base_texto": (
            "edificações em lote de uso residencial (SEFIN, 2022)"
            if r and r.base_edificacoes == "residenciais"
            else "todas as edificações (o uso do lote não foi classificado)"
        ),
        "edificacoes": r.edificacoes if r else 0,
        "classificadas": meta.get("edificacoes_classificadas"),
        "edificacoes_no_bairro": meta.get("edificacoes_no_bairro"),
        "limiar_ndvi": meta.get("limiar_ndvi"),
        "partes": partes,
        "regra": regra.REGRA,
        "fonte_metodo": regra.FONTE_METODO,
        "fonte_url": regra.FONTE_URL,
        "metodo": regra.METODO,
        "ressalva": regra.RESSALVA_INVENTARIO,
        "rotulo_cidade": "Fortaleza",
    }


def bloco_macrozoneamento(bairro) -> dict | None:
    """Zonas do macrozoneamento que tocam o bairro, com a parte da área de cada uma."""
    zonas = macrozoneamento.partilha_do_bairro(bairro.pk)
    if not zonas:
        return None
    return {
        "zonas": zonas,
        "predominante": zonas[0]["nome"],
        "fonte": macrozoneamento.FONTE,
        "fonte_url": macrozoneamento.URL_PAGINA,
        "licenca": macrozoneamento.LICENCA,
        "data_referencia": macrozoneamento.DATA_REFERENCIA,
    }


def cartoes_ficha(bairro, usuario, cartao, rotulo_cidade: str, contagem: str = regra.TODAS) -> list:
    """Cartões do IPTU médio, das inscrições e das áreas edificadas (SEFIN) da ficha do bairro."""
    from . import populacao_indicadores as pi

    todos = {
        pk: v for pk, v in colunas([b.pk for b in pi.bairros_do_escopo(usuario)], contagem).items()
    }
    x = todos.get(bairro.pk, {})
    cartoes = []
    for ind, chave in CHAVES_SEFIN.items():
        spec = sefin.FONTES[ind]
        linha = IndicadorTerritorialExterno.objects.filter(territorio=bairro, indicador=ind).first()
        valores = [v[chave] for v in todos.values() if v.get(chave) is not None]
        escala = {"min": min(valores), "max": max(valores)} if len(valores) > 1 else None
        base_den = None
        if ind == sefin.IPTU_MEDIO:
            linhas = IndicadorTerritorialExterno.objects.filter(indicador=ind)
            num = sum(i.numerador for i in linhas)
            den = sum(i.denominador or 0 for i in linhas)
            cidade = {"valor": round(num / den, 2), "rotulo": "Fortaleza"} if den else None
        else:
            soma = sum(v[chave] for v in todos.values() if v.get(chave) is not None)
            cidade = (
                {"valor": round(soma / len(valores), 2), "rotulo": "Média por bairro"}
                if valores
                else None
            )
        cartoes.append(
            cartao(
                chave,
                sefin_nome(ind),
                valor=x.get(chave),
                unidade=spec["unidade"],
                sem_dado=x.get(chave) is None,
                nota=(
                    "Sem dado da SEFIN para este bairro."
                    if x.get(chave) is None
                    else "Imposto lançado: não é renda nem valor de mercado."
                    if ind == sefin.IPTU_MEDIO
                    else ""
                ),
                detalhe=(
                    f"{linha.denominador:,} inscrições".replace(",", ".")
                    if linha and linha.denominador
                    else ""
                ),
                base=base_den,
                cidade=cidade,
                escala=escala,
                fonte=linha.fonte if linha else sefin.ORGAO,
                fonte_url=linha.fonte_url if linha else "",
                licenca=linha.licenca if linha else sefin.LICENCA,
                data_referencia=linha.data_referencia if linha else None,
                definicao=spec["definicao"],
                metodo=spec["metodo"],
            )
        )
    return cartoes


def sefin_nome(indicador: str) -> str:
    return sefin.NOMES[indicador]


# --- Análises (ranking e dispersão com a renda) ------------------------------------------------


def linhas_regra(usuario, parte: str, contagem: str = regra.TODAS) -> list[dict]:
    """Ranking por bairro de uma parte da regra 3-30-300 (só bairros com dado, nunca zero)."""
    from . import populacao_indicadores as pi

    chave = {"3": "r3", "30": "r30", "300": "r300"}[parte]
    saida = []
    for x in pi.quadro(usuario, contagem=contagem):
        if x[chave] is None:
            continue
        r = regra.resultados([x["id"]], contagem).get(x["id"])
        p = regra.partes_do_resultado(r)[parte] if r else None
        detalhe = (
            f"{pi._br(p.numerador)} de {pi._br(p.denominador)} "
            + ("pixels com vegetação" if parte == "30" else "edificações")
            if p and p.denominador
            else ""
        )
        saida.append(
            {
                "rotulo": x["nome"],
                "valor": x[chave],
                "territorio_id": str(x["id"]),
                "detalhe": detalhe,
                "numerador": p.numerador if p else None,
                "base": p.denominador if p else None,
            }
        )
    return sorted(saida, key=lambda r: (-r["valor"], r["rotulo"]))


def dispersao_regra(usuario, parte: str, contagem: str = regra.TODAS) -> dict:
    """Uma parte da regra 3-30-300 × rendimento médio do responsável, por bairro (só descrição)."""
    import statistics

    from . import populacao_indicadores as pi

    chave = {"3": "r3", "30": "r30", "300": "r300"}[parte]
    pontos = [
        {
            "id": str(x["id"]),
            "rotulo": x["nome"],
            "x": x["renda"],
            "y": x[chave],
            "populacao": x["populacao"],
            "arvores": x["arvores"],
        }
        for x in pi.quadro(usuario, contagem=contagem)
        if x["renda"] is not None and x[chave] is not None
    ]
    r = None
    if len(pontos) >= 3 and len({p["x"] for p in pontos}) > 1 and len({p["y"] for p in pontos}) > 1:
        r = round(statistics.correlation([p["x"] for p in pontos], [p["y"] for p in pontos]), 2)
    return {
        "x_rotulo": "Rendimento médio do responsável (R$, Censo 2022)",
        "y_rotulo": f"{regra.PARTES[parte]['nome']} (% — regra 3-30-300)",
        "pontos": pontos,
        "correlacao": {
            "r": r,
            "bairros": len(pontos),
            "metodo": "Correlação linear de Pearson entre as duas colunas, sobre os bairros com os "
            "dois valores. É só uma descrição dos dados: não mede causa, não é índice oficial. "
            + regra.RESSALVA_INVENTARIO,
        },
    }


def linhas_dispersao_regra(usuario, parte: str, contagem: str = regra.TODAS) -> list[dict]:
    d = dispersao_regra(usuario, parte, contagem)
    saida = [
        {
            "rotulo": p["rotulo"],
            "valor": p["y"],
            "territorio_id": p["id"],
            "renda": p["x"],
            "detalhe": f"rendimento médio do responsável R$ {p['x']:,.0f}".replace(",", "."),
        }
        for p in d["pontos"]
    ]
    return sorted(saida, key=lambda r: (-r["renda"], r["rotulo"]))
