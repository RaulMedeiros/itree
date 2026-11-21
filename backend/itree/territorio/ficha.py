"""Ficha do bairro: tudo o que a plataforma sabe de um bairro, numa só resposta.

Não calcula nada novo à mão: reaproveita o que já existe por bairro (instantâneos da visão geral,
ordenação de "Bairros que pedem atenção", Censo 2022, iluminação, plantio da URBFOR, áreas verdes,
alertas e manejo). Cada cartão traz fonte e data; quando o dado não existe para o bairro, o cartão
vem com ``sem_dado`` e a explicação em ``nota``, nunca zero. O número de consultas não depende da
quantidade de registros do bairro.
"""

import json
from datetime import date, datetime, timedelta

from django.contrib.gis.db.models.functions import AsGeoJSON
from django.db.models import Count, F, FloatField, Func, Q, QuerySet, Sum
from django.db.models.functions import TruncMonth

from itree.alertas.escopo import filtrar_alertas_por_escopo
from itree.alertas.models import AlertaAmbiental, TipoAlerta
from itree.alertas.views import filtrar_por_bairro
from itree.areas_verdes.models import AdocaoPraca, AreaVerde, TipoAreaVerde
from itree.contas.acesso import filtrar_por_escopo, tem_escopo_municipal
from itree.contas.models import Usuario
from itree.iluminacao import servico as iluminacao
from itree.iluminacao.models import PontoIluminacao
from itree.indicadores import (
    atencao,
    externos,
    ilha_calor,
    instantaneos,
    manejo_urbfor,
    populacao_indicadores,
)
from itree.indicadores import (
    contagem as cont,
)
from itree.indicadores.doacao_plantio import FONTE as FONTE_URBFOR
from itree.indicadores.doacao_plantio import FONTE_URL as FONTE_URL_URBFOR
from itree.indicadores.doacao_plantio import LICENCA as LICENCA_URBFOR
from itree.indicadores.models import IndicadorTerritorialExterno, RegistroPlantio
from itree.inspecoes.models import CondicaoAparente
from itree.inventario.models import Arvore, EstadoEspecie
from itree.ocorrencias.models import ESTADOS_FINAIS, Ocorrencia
from itree.tarefas.models import ESTADOS_FINAIS_TAREFA, Tarefa

from .models import Territorio, TipoTerritorio

FONTE_INTERNA = "Registros da plataforma"
TOP_ESPECIES = 8
MESES_SERIE = 12
JANELA_ALERTAS_DIAS = 365
LIMITE_PLANTIO_ANO = 2022

ROTULOS_CONDICAO = {
    **dict(CondicaoAparente.choices),
    "": "Sem avaliação registrada",
}
ORDEM_CONDICAO = ["boa", "regular", "ruim", "morta", "nao_avaliada", ""]


class AreaM2(Func):
    """Área em m² de um polígono 4326, na geografia (esferoide)."""

    output_field = FloatField()

    def as_sql(self, compiler, connection, **extra):
        sql, params = compiler.compile(self.get_source_expressions()[0])
        return f"ST_Area(({sql})::geography)", params


def bairros_para_ficha(bairros: QuerySet[Territorio]) -> QuerySet[Territorio]:
    return bairros.select_related("pai").annotate(
        geometria=AsGeoJSON("geom", precision=5), area_m2=AreaM2(F("geom"))
    )


def _pct(parte: int, base: int) -> float | None:
    return round(100 * parte / base, 1) if base else None


def _cartao(
    id_: str,
    titulo: str,
    *,
    valor: float | int | None = None,
    unidade: str = "",
    detalhe: str = "",
    nota: str = "",
    sem_dado: bool = False,
    provisorio: bool = False,
    base: int | None = None,
    cidade: dict | None = None,
    extras: list[dict] | None = None,
    fonte: str = FONTE_INTERNA,
    fonte_url: str = "",
    licenca: str = "",
    data_referencia: date | datetime | None = None,
    definicao: str = "",
    metodo: str = "",
    link: dict | None = None,
    escala: dict | None = None,
) -> dict:
    return {
        "id": id_,
        "titulo": titulo,
        "valor": None if sem_dado else valor,
        "unidade": unidade,
        "detalhe": detalhe,
        "nota": nota,
        "sem_dado": sem_dado,
        "provisorio": provisorio,
        "base": base,
        "cidade": cidade,
        "extras": extras or [],
        "fonte": fonte,
        "fonte_url": fonte_url,
        "licenca": licenca,
        "data_referencia": data_referencia.date()
        if isinstance(data_referencia, datetime)
        else data_referencia,
        "definicao": definicao,
        "metodo": metodo,
        "link": link,
        # Menor e maior valor entre os bairros, para a régua de indicadores que não são percentuais.
        "escala": escala,
    }


def _contagens_arvores(arvores: QuerySet) -> dict:
    validas = instantaneos.arvores_validas(arvores)
    return validas.aggregate(
        validas=Count("pk"),
        especie_confirmada=Count("pk", filter=Q(especie_estado=EstadoEspecie.CONFIRMADA)),
        ruins=Count(
            "pk", filter=Q(condicao_aparente__in=[CondicaoAparente.RUIM, CondicaoAparente.MORTA])
        ),
    ) | {"registros": arvores.count()}


def _referencia(contagens: dict, campo: str, rotulo: str) -> dict | None:
    valor = _pct(contagens[campo], contagens["validas"])
    return None if valor is None else {"valor": valor, "rotulo": rotulo}


def _grafico_especies(validas: QuerySet) -> dict:
    confirmadas = (
        validas.filter(especie_estado=EstadoEspecie.CONFIRMADA)
        .values("especie__nome_cientifico")
        .annotate(n=Count("pk"))
        .order_by("-n", "especie__nome_cientifico")
    )
    linhas = list(confirmadas)
    itens = [
        {"id": "", "rotulo": linha["especie__nome_cientifico"] or "Sem nome", "valor": linha["n"]}
        for linha in linhas[:TOP_ESPECIES]
    ]
    restante = linhas[TOP_ESPECIES:]
    if restante:
        itens.append(
            {
                "id": "outras",
                "rotulo": f"Outras ({len(restante)} espécies)",
                "valor": sum(linha["n"] for linha in restante),
            }
        )
    total_confirmadas = sum(linha["n"] for linha in linhas)
    return {
        "titulo": "Composição por espécie",
        "definicao": (
            f"As {TOP_ESPECIES} espécies confirmadas por revisor mais frequentes entre as "
            "árvores válidas do bairro; o restante das confirmadas entra em “Outras”."
        ),
        "itens": itens,
        "total_confirmadas": total_confirmadas,
        "fonte": FONTE_INTERNA,
    }


def _grafico_condicao(validas: QuerySet) -> dict:
    contagem = {
        c["condicao_aparente"]: c["n"]
        for c in validas.values("condicao_aparente").annotate(n=Count("pk")).order_by()
    }
    itens = [
        {"id": c or "sem", "rotulo": ROTULOS_CONDICAO[c], "valor": contagem[c]}
        for c in ORDEM_CONDICAO
        if contagem.get(c)
    ]
    return {
        "titulo": "Condição aparente",
        "definicao": (
            "Última condição validada de cada árvore válida do bairro. Sem inspeção validada, "
            "a árvore aparece como “sem avaliação registrada”."
        ),
        "itens": itens,
        "fonte": FONTE_INTERNA,
    }


def _serie_ocorrencias(ocorrencias: QuerySet, hoje: date) -> dict:
    ano, mes = hoje.year, hoje.month
    meses = []
    for _ in range(MESES_SERIE):
        meses.append(f"{ano:04d}-{mes:02d}")
        ano, mes = (ano - 1, 12) if mes == 1 else (ano, mes - 1)
    meses.reverse()
    primeiro = date(int(meses[0][:4]), int(meses[0][5:]), 1)
    contagem = {
        linha["mes"].strftime("%Y-%m"): linha["n"]
        for linha in ocorrencias.filter(criado_em__date__gte=primeiro)
        .annotate(mes=TruncMonth("criado_em"))
        .values("mes")
        .annotate(n=Count("pk"))
        .order_by()
        if linha["mes"]
    }
    return {
        "titulo": "Ocorrências registradas por mês",
        "definicao": "Ocorrências registradas no bairro em cada um dos últimos 12 meses.",
        "meses": meses,
        "valores": [contagem.get(m, 0) for m in meses],
        "fonte": FONTE_INTERNA,
    }


def _cartao_censo(bairro: Territorio, usuario: Usuario) -> dict:
    nome = externos.NOME_ARBORIZACAO
    indicador = IndicadorTerritorialExterno.objects.filter(
        territorio=bairro, indicador=externos.ARBORIZACAO_FACES
    ).first()
    if indicador is None or indicador.valor is None:
        return _cartao(
            "arborizacao_entorno",
            nome,
            sem_dado=True,
            unidade="%",
            nota="O Censo 2022 não tem esse dado para este bairro (código ausente ou omitido "
            "por sigilo).",
            fonte=externos.FONTE_CENSO,
            fonte_url=externos.URL_CENSO_FACES,
            licenca=externos.LICENCA_CENSO,
            data_referencia=externos.DATA_REFERENCIA_CENSO,
            definicao=externos.DEFINICAO_ARBORIZACAO,
            metodo=externos.METODO_ARBORIZACAO,
        )
    escopo = next(
        (i for i in externos.contexto_externo(usuario) if i["id"] == externos.ARBORIZACAO_FACES),
        None,
    )
    return _cartao(
        "arborizacao_entorno",
        nome,
        valor=float(indicador.valor),
        unidade="%",
        base=indicador.denominador,
        detalhe=f"{indicador.numerador:,} de {indicador.denominador:,} faces de quadra".replace(
            ",", "."
        ),
        nota="Percepção do recenseador sobre a face de quadra; não mede copa nem cobertura.",
        cidade=_cidade(escopo["valor"], usuario)
        if escopo and escopo["valor"] is not None
        else None,
        fonte=indicador.fonte,
        fonte_url=indicador.fonte_url,
        licenca=indicador.licenca,
        data_referencia=indicador.data_referencia,
        definicao=indicador.definicao,
        metodo=indicador.metodo,
    )


def _rotulo_cidade(usuario: Usuario) -> str:
    return "Média de Fortaleza" if tem_escopo_municipal(usuario) else "Média do seu escopo"


def _cidade(valor: float, usuario: Usuario) -> dict:
    return {"valor": valor, "rotulo": _rotulo_cidade(usuario)}


def _cartao_ilha_calor(bairro: Territorio) -> dict:
    indicador = IndicadorTerritorialExterno.objects.filter(
        territorio=bairro, indicador=ilha_calor.INDICADOR
    ).first()
    link = {"pagina": "/mapa", "filtros": {"ilha_calor": "1", "destaque": str(bairro.pk)}}
    comum = {
        "fonte": ilha_calor.FONTE,
        "fonte_url": ilha_calor.URL_FONTE,
        "licenca": ilha_calor.LICENCA,
        "data_referencia": ilha_calor.DATA_REFERENCIA,
        "definicao": ilha_calor.DEFINICAO,
        "metodo": ilha_calor.METODO,
        "link": link,
    }
    if indicador is None or indicador.valor is None:
        return _cartao(
            "ilha_calor",
            ilha_calor.NOME,
            sem_dado=True,
            unidade="°C",
            nota="Veja a camada no mapa. O valor por bairro não é gravado enquanto o uso dos "
            "dados da UrbVerde não for confirmado com a USP.",
            **comum,
        )
    media = ilha_calor.media_da_cidade()
    cobertura = _pct(indicador.numerador, indicador.denominador or 0)
    return _cartao(
        "ilha_calor",
        ilha_calor.NOME,
        valor=float(indicador.valor),
        unidade="°C",
        base=indicador.denominador,
        detalhe=(
            f"Média dos pixels de 30 m do bairro; {cobertura:.0f}% do bairro com medição"
            if cobertura is not None
            else ""
        ),
        nota="Diferença para a mediana de Fortaleza, medida na superfície; não é a temperatura "
        "do ar.",
        cidade={"valor": media["valor"], "rotulo": "Média de Fortaleza"} if media else None,
        **{**comum, "fonte_url": indicador.fonte_url or comum["fonte_url"]},
    )


def _cartao_iluminacao(bairro: Territorio, arvores: QuerySet) -> dict:
    titulo = "Árvores próximas à iluminação"
    resumo = iluminacao.resumo_da_iluminacao()
    raio = iluminacao.raio_de_conflito_m()
    comum = {
        "provisorio": True,
        "definicao": (
            f"Árvores ativas a até {raio:g} m de um ponto de iluminação pública (SEINF). "
            "É só proximidade: não afirma dano nem risco. O raio é provisório (DP-22)."
        ),
        "metodo": (
            f"Distância geodésica entre a árvore e o ponto de iluminação mais próximo, com o "
            f"raio provisório de {raio:g} m. Só árvores do bairro com localização."
        ),
    }
    if resumo is None:
        return _cartao(
            "iluminacao",
            titulo,
            sem_dado=True,
            nota="A iluminação pública ainda não foi importada.",
            fonte="Iluminação pública (SEINF)",
            **comum,
        )
    perto = iluminacao.arvores_em_conflito(instantaneos.arvores_validas(arvores), raio).count()
    pontos = PontoIluminacao.objects.filter(geom__intersects=bairro.geom).count()
    return _cartao(
        "iluminacao",
        titulo,
        valor=perto,
        detalhe=f"{pontos:,} pontos de iluminação no bairro".replace(",", "."),
        nota=f"Provisório: raio de {raio:g} m, em definição pela URBFOR e pela SEINF.",
        fonte=resumo["fonte"],
        fonte_url=resumo["fonte_url"],
        licenca=resumo["licenca"],
        data_referencia=resumo["data_referencia"],
        link={"pagina": "/inventario/iluminacao", "filtros": {}},
        **comum,
    )


def _cartao_plantio(bairro: Territorio) -> dict:
    titulo = "Mudas plantadas (URBFOR, 2022)"
    totais = RegistroPlantio.objects.aggregate(
        mudas=Sum("total_mudas"),
        com_bairro=Sum("total_mudas", filter=Q(bairro__isnull=False)),
    )
    do_bairro = RegistroPlantio.objects.filter(bairro=bairro).aggregate(
        mudas=Sum("total_mudas"), fichas=Count("pk")
    )
    cobertura = (
        f"Só {_pct(totais['com_bairro'] or 0, totais['mudas']):g}% das mudas da planilha trazem "
        "bairro no endereço; o restante não pôde ser ligado a nenhum bairro."
        if totais["mudas"]
        else ""
    )
    comum = {
        "fonte": FONTE_URBFOR,
        "fonte_url": FONTE_URL_URBFOR,
        "licenca": LICENCA_URBFOR,
        "data_referencia": date(LIMITE_PLANTIO_ANO, 12, 31),
        "definicao": (
            "Mudas plantadas pela URBFOR em 2022, somadas pelo bairro lido do texto do endereço "
            "da ficha. Muitas são ornamentais pequenas e não viram árvores do inventário."
        ),
        "metodo": "Soma de mudas das fichas de plantio cujo endereço foi ligado a este bairro. "
        + cobertura,
    }
    if not do_bairro["fichas"]:
        return _cartao(
            "plantio",
            titulo,
            sem_dado=True,
            nota="Nenhum plantio de 2022 foi identificado neste bairro. Isso não é o mesmo que "
            "zero: a planilha traz o bairro só em parte das fichas. " + cobertura,
            **comum,
        )
    return _cartao(
        "plantio",
        titulo,
        valor=do_bairro["mudas"],
        detalhe=f"{do_bairro['fichas']} plantio(s) identificado(s) no bairro",
        nota=cobertura,
        **comum,
    )


def _cartao_areas_verdes(bairro: Territorio) -> dict:
    areas = {
        linha["tipo"]: linha["n"]
        for linha in AreaVerde.objects.filter(geom__intersects=bairro.geom)
        .values("tipo")
        .annotate(n=Count("pk"))
        .order_by()
    }
    adotadas = (
        AdocaoPraca.objects.filter(geom__within=bairro.geom, area_verde__isnull=False)
        .values("area_verde")
        .distinct()
        .count()
    )
    ultima = (
        AreaVerde.objects.order_by("-ingerido_em")
        .values("fonte", "fonte_url", "licenca", "data_referencia", "ingerido_em")
        .first()
    )
    definicao = (
        "Praças, parques urbanos e unidades de conservação do Fortaleza em Mapas que tocam o "
        "bairro, e as praças com termo de adoção (mapa 622). A adoção é ligada à praça mais "
        "próxima, a até 50 m; o nome do adotante não é guardado."
    )
    if ultima is None:
        return _cartao(
            "areas_verdes",
            "Áreas verdes e praças adotadas",
            sem_dado=True,
            nota="As áreas verdes ainda não foram importadas.",
            fonte="Fortaleza em Mapas (Ipplan Fortaleza)",
            definicao=definicao,
        )
    total = sum(areas.values())
    return _cartao(
        "areas_verdes",
        "Áreas verdes e praças adotadas",
        valor=total,
        detalhe=(
            f"{areas.get(TipoAreaVerde.PRACA, 0)} praça(s), "
            f"{areas.get(TipoAreaVerde.PARQUE, 0)} parque(s), "
            f"{areas.get(TipoAreaVerde.UNIDADE_CONSERVACAO, 0)} unidade(s) de conservação"
        ),
        extras=[{"rotulo": "Praças adotadas", "valor": str(adotadas)}],
        fonte=ultima["fonte"],
        fonte_url=ultima["fonte_url"],
        licenca=ultima["licenca"],
        data_referencia=ultima["data_referencia"] or ultima["ingerido_em"],
        definicao=definicao,
        metodo="Áreas cujo polígono intersecta o bairro (um parque grande conta em cada bairro "
        "que ele toca).",
        link={"pagina": "/mapa", "filtros": {"areas_verdes": "1", "destaque": str(bairro.pk)}},
    )


def _cartao_alertas(bairro: Territorio, usuario: Usuario, hoje: date) -> dict:
    titulo = "Focos de calor e alertas (12 meses)"
    comum = {
        "fonte": "INPE (focos de calor) e demais fontes de alerta configuradas",
        "definicao": (
            "Alertas ambientais detectados no bairro nos últimos 12 meses. São sinais externos "
            "para triagem humana: não provam irregularidade."
        ),
        "metodo": "Alertas cuja geometria intersecta o bairro, pela data de detecção.",
    }
    if not usuario.tem_permissao("alertas.ler"):
        return _cartao(
            "alertas",
            titulo,
            sem_dado=True,
            nota="Seu perfil não tem acesso aos alertas ambientais.",
            **comum,
        )
    desde = hoje - timedelta(days=JANELA_ALERTAS_DIAS)
    alertas = filtrar_por_bairro(
        filtrar_alertas_por_escopo(AlertaAmbiental.objects.all(), usuario), bairro.pk
    ).filter(data_deteccao__date__gte=desde)
    por_tipo = {
        linha["tipo"]: linha["n"]
        for linha in alertas.values("tipo").annotate(n=Count("pk")).order_by()
    }
    focos = por_tipo.get(TipoAlerta.FOCO_CALOR, 0)
    outros = sum(n for t, n in por_tipo.items() if t != TipoAlerta.FOCO_CALOR)
    return _cartao(
        "alertas",
        titulo,
        valor=focos + outros,
        detalhe=f"{focos} foco(s) de calor e {outros} outro(s) alerta(s)",
        nota="Sinal externo, não prova irregularidade. Zero quer dizer nenhum alerta recebido, "
        "não ausência de ocorrência.",
        data_referencia=hoje,
        link={"pagina": "/alertas", "filtros": {"bairro": str(bairro.pk)}},
        **comum,
    )


def _cartao_manejo(bairro: Territorio) -> dict:
    titulo = "Manejo registrado pela URBFOR (2023)"
    soma = dict.fromkeys(manejo_urbfor.ACOES, 0)
    ingestao = None
    for i in IndicadorTerritorialExterno.objects.filter(
        territorio=bairro, indicador__startswith=manejo_urbfor.PREFIXO
    ):
        interpretado = manejo_urbfor.interpretar_indicador(i.indicador)
        if interpretado is None or interpretado[3]:
            continue
        soma[interpretado[0]] += i.numerador
        ingestao = max(filter(None, [ingestao, i.ingerido_em]))
    comum = {
        "fonte": manejo_urbfor.FONTE,
        "fonte_url": manejo_urbfor.FONTE_URL,
        "licenca": manejo_urbfor.LICENCA,
        "definicao": (
            "Serviços de poda, supressão e recolhimento registrados pela URBFOR em 2023, "
            "somados pelo bairro lido do texto do endereço."
        ),
        "metodo": manejo_urbfor.METODO,
    }
    if ingestao is None:
        return _cartao(
            "manejo",
            titulo,
            sem_dado=True,
            nota="Nenhum serviço de manejo de 2023 foi identificado neste bairro. Não é o mesmo "
            "que zero: parte dos registros da URBFOR não traz o bairro.",
            **comum,
        )
    return _cartao(
        "manejo",
        titulo,
        valor=sum(soma.values()),
        detalhe=" · ".join(
            f"{soma[a]} {rotulo.lower()}" for a, rotulo in manejo_urbfor.ACOES.items() if soma[a]
        ),
        data_referencia=ingestao,
        **comum,
    )


def _ranking(
    bairro: Territorio, usuario: Usuario, arvores: QuerySet, ocorrencias: QuerySet, hoje, agora
) -> dict:
    itens = atencao.itens_do_ranking(usuario, arvores, ocorrencias, hoje=hoje, agora=agora)
    do_bairro = next((i for i in itens if i["id"] == bairro.pk), None)
    posicao = next((n for n, i in enumerate(itens, 1) if i["id"] == bairro.pk), None)
    return {
        "titulo": "Bairros que pedem atenção",
        "definicao": atencao.DEFINICAO,
        "formula": atencao.FORMULA,
        "posicao": posicao,
        "total": len(itens),
        "indice": do_bairro["indice"] if do_bairro else 0,
        "componentes": do_bairro["componentes"] if do_bairro else [],
        "fonte": FONTE_INTERNA,
    }


def montar(
    bairro: Territorio,
    usuario: Usuario,
    *,
    hoje: date,
    agora: datetime,
    contagem: str = cont.TODAS,
) -> dict:
    """``bairro`` vem de ``bairros_para_ficha`` e já está no escopo de ``usuario``.

    ``contagem`` (``todas`` ou ``confirmadas``) escolhe quais árvores alimentam os indicadores
    do bairro; o cartão de árvores mostra sempre as duas contagens."""
    geom = bairro.geom
    arvores = Arvore.objects.filter(geom__intersects=geom)
    validas_total, validas_confirmadas = cont.totais(instantaneos.arvores_validas(arvores))
    arvores = cont.filtrar(arvores, contagem)
    ocorrencias = Ocorrencia.objects.filter(geom__intersects=geom)
    tarefas = Tarefa.objects.filter(geom__intersects=geom)
    validas = instantaneos.arvores_validas(arvores)

    arvores_escopo = filtrar_por_escopo(Arvore.objects.all(), usuario, incluir_sem_geom=True)
    ocorrencias_escopo = filtrar_por_escopo(Ocorrencia.objects.all(), usuario)
    do_bairro = _contagens_arvores(arvores)
    do_escopo = _contagens_arvores(arvores_escopo)

    abertas = ocorrencias.exclude(estado__in=ESTADOS_FINAIS)
    oco = abertas.aggregate(abertas=Count("pk"), atrasadas=Count("pk", filter=Q(prazo__lt=hoje)))
    tar = tarefas.exclude(estado__in=ESTADOS_FINAIS_TAREFA).aggregate(
        abertas=Count("pk"), atrasadas=Count("pk", filter=Q(prazo__lt=hoje))
    )
    rotulo_cidade = _rotulo_cidade(usuario)

    cartoes = [
        _cartao(
            "arvores",
            "Árvores cadastradas",
            valor=do_bairro["validas"],
            detalhe=f"{cont.rotulo(validas_total, validas_confirmadas)} · "
            f"{do_bairro['registros']} registro(s) no total, em qualquer situação",
            extras=[
                {"rotulo": "Todas", "valor": str(validas_total)},
                {"rotulo": "Confirmadas", "valor": str(validas_confirmadas)},
            ],
            data_referencia=hoje,
            definicao=f"Registros {_DEFINICAO_VALIDA} dentro do bairro.",
            metodo="Contagem de árvores válidas cuja localização intersecta o bairro.",
            link={"pagina": "/inventario/arvores", "filtros": {}},
        ),
        _cartao(
            "especie_confirmada",
            "Espécie confirmada",
            valor=_pct(do_bairro["especie_confirmada"], do_bairro["validas"]),
            sem_dado=not do_bairro["validas"],
            nota="Sem árvores válidas no bairro." if not do_bairro["validas"] else "",
            unidade="%",
            base=do_bairro["validas"],
            detalhe=f"{do_bairro['especie_confirmada']} de {do_bairro['validas']} árvores válidas",
            cidade=_referencia(do_escopo, "especie_confirmada", rotulo_cidade),
            data_referencia=hoje,
            definicao="Percentual de árvores válidas com espécie confirmada por revisor.",
            metodo="confirmadas ÷ válidas × 100, no bairro. A referência usa o mesmo cálculo "
            "no seu escopo.",
        ),
        _cartao(
            "condicao_ruim",
            "Condição ruim ou aparentemente morta",
            valor=_pct(do_bairro["ruins"], do_bairro["validas"]),
            sem_dado=not do_bairro["validas"],
            nota="Sem árvores válidas no bairro." if not do_bairro["validas"] else "",
            unidade="%",
            base=do_bairro["validas"],
            detalhe=f"{do_bairro['ruins']} de {do_bairro['validas']} árvores válidas",
            cidade=_referencia(do_escopo, "ruins", rotulo_cidade),
            data_referencia=hoje,
            definicao="Percentual de árvores válidas cuja última condição aparente validada é "
            "ruim ou aparentemente morta. Árvores sem avaliação não entram no numerador.",
            metodo="(ruins + mortas) ÷ válidas × 100, no bairro. A referência usa o mesmo "
            "cálculo no seu escopo.",
            link={"pagina": "/inventario/arvores", "filtros": {"condicao_aparente": "ruim"}},
        ),
        _cartao(
            "ocorrencias",
            "Ocorrências abertas",
            valor=oco["abertas"],
            detalhe=f"{oco['atrasadas']} com prazo vencido",
            extras=[{"rotulo": "Atrasadas", "valor": str(oco["atrasadas"])}],
            data_referencia=hoje,
            definicao="Ocorrências não concluídas nem canceladas, dentro do bairro. Não inclui "
            "alertas ambientais.",
            metodo="Contagem; atrasada é a aberta com prazo anterior a hoje.",
            link={"pagina": "/ocorrencias", "filtros": {}},
        ),
        _cartao(
            "tarefas",
            "Tarefas em aberto",
            valor=tar["abertas"],
            detalhe=f"{tar['atrasadas']} com prazo vencido",
            extras=[{"rotulo": "Atrasadas", "valor": str(tar["atrasadas"])}],
            data_referencia=hoje,
            definicao="Tarefas não concluídas nem canceladas cujo alvo está dentro do bairro.",
            metodo="Contagem; atrasada é a aberta com prazo anterior a hoje.",
            link={"pagina": "/equipes-tarefas", "filtros": {}},
        ),
        _cartao_censo(bairro, usuario),
        *populacao_indicadores.cartoes_ficha(bairro, usuario, _cartao, rotulo_cidade, contagem),
        _cartao_ilha_calor(bairro),
        _cartao_iluminacao(bairro, arvores),
        _cartao_plantio(bairro),
        _cartao_manejo(bairro),
        _cartao_areas_verdes(bairro),
        _cartao_alertas(bairro, usuario, hoje),
    ]

    regional = bairro.pai if bairro.pai and bairro.pai.tipo == TipoTerritorio.REGIONAL else None
    oficial = "ipplan" in (bairro.fonte or "").lower()
    return {
        "gerado_em": agora,
        "bairro": {
            "id": bairro.pk,
            "nome": bairro.nome,
            "codigo": bairro.codigo,
            "regional": {"id": regional.pk, "nome": regional.nome} if regional else None,
            "area_km2": round(bairro.area_m2 / 1_000_000, 2) if bairro.area_m2 else None,
            "oficial": oficial,
            "selo": "Bairro oficial (Ipplan)" if oficial else "Bairro cadastrado",
            "fonte": bairro.fonte,
            "fonte_url": bairro.fonte_url,
            "data_referencia": bairro.data_referencia,
            "limites": list(geom.extent),
            "geometria": json.loads(bairro.geometria),
        },
        "cartoes": cartoes,
        "graficos": {
            "especies": _grafico_especies(validas),
            "condicao": _grafico_condicao(validas),
            "ocorrencias_mensais": _serie_ocorrencias(ocorrencias, hoje),
        },
        "ranking": _ranking(bairro, usuario, arvores_escopo, ocorrencias_escopo, hoje, agora),
    }


_DEFINICAO_VALIDA = (
    "ativos, com localização e origem da localização conhecida "
    "(critério provisório, em definição pela prefeitura)"
)
