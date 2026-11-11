"""Visão geral (W-06). Todo indicador declara definição, fórmula, base, período
e fonte. Ausência de dados é ``null``, nunca zero (RN-VG-001)."""

from datetime import date, timedelta

from django.db.models import Avg, Count, F, Q
from django.db.models.functions import TruncMonth
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from pghistory.models import Events
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from itree.alertas.models import AlertaAmbiental, StatusAlerta
from itree.auditoria.views import ENTIDADES, EventoAuditoriaSerializer
from itree.contas.acesso import filtrar_por_escopo
from itree.contas.models import Equipe
from itree.core.parametros import uuid_do_parametro
from itree.indicadores import externos, instantaneos
from itree.inspecoes.models import CondicaoAparente, EstadoInspecao, Inspecao
from itree.inventario.models import Arvore, EstadoEspecie
from itree.ocorrencias.models import ESTADOS_FINAIS, EstadoOcorrencia, Ocorrencia, Prioridade
from itree.tarefas.models import ESTADOS_FINAIS_TAREFA, Tarefa
from itree.territorio.models import Territorio

FONTE_INTERNA = "Registros da plataforma"
DEFINICAO_VALIDA = (
    "ativa, com localização e origem da localização conhecida (RN-INV-001, provisório)"
)


def _pct(parte: int, base: int) -> float | None:
    return round(100 * parte / base, 1) if base else None


def _data(valor: str | None, nome: str, padrao: date) -> date:
    if not valor:
        return padrao
    try:
        return date.fromisoformat(valor)
    except ValueError as exc:
        raise ValidationError({nome: ["Use AAAA-MM-DD."]}) from exc


Painel = inline_serializer(
    "PainelIndicadores",
    {
        "periodo": serializers.DictField(),
        "filtros": serializers.DictField(),
        "calculado_em": serializers.DateTimeField(),
        "indicadores": serializers.ListField(child=serializers.DictField()),
        "contexto_externo": serializers.ListField(child=serializers.DictField()),
        "distribuicoes": serializers.DictField(),
        "series_mensais": serializers.DictField(),
        "pendencias": serializers.ListField(child=serializers.DictField()),
        "equipes": serializers.ListField(child=serializers.DictField()),
        "atividades": EventoAuditoriaSerializer(many=True),
    },
)


@extend_schema(
    operation_id="indicadores_painel",
    parameters=[
        OpenApiParameter("inicio", str, description="AAAA-MM-DD (padrão: 30 dias atrás)"),
        OpenApiParameter("fim", str, description="AAAA-MM-DD (padrão: hoje)"),
        OpenApiParameter("bairro", str),
        OpenApiParameter("equipe", str),
    ],
    responses=Painel,
)
@api_view(["GET"])
def painel(request: Request):
    usuario = request.user
    if not (usuario.tem_permissao("relatorios.ler") or usuario.tem_permissao("inventario.ler")):
        raise PermissionDenied()
    hoje = timezone.localdate()
    p = request.query_params
    fim = _data(p.get("fim"), "fim", hoje)
    inicio = _data(p.get("inicio"), "inicio", fim - timedelta(days=30))
    if inicio > fim:
        raise ValidationError({"inicio": ["O início deve ser anterior ao fim."]})

    arvores = filtrar_por_escopo(Arvore.objects.all(), usuario, incluir_sem_geom=True)
    ocorrencias = filtrar_por_escopo(Ocorrencia.objects.all(), usuario)
    inspecoes = filtrar_por_escopo(Inspecao.objects.all(), usuario, campo_geom="arvore__geom")
    tarefas = filtrar_por_escopo(Tarefa.objects.all(), usuario)

    bairro_nome = equipe_nome = bairro_obj = None
    if bairro := p.get("bairro"):
        t = Territorio.objects.filter(pk=uuid_do_parametro(bairro, "bairro")).first()
        if t is None:
            raise ValidationError({"bairro": ["Território não encontrado."]})
        bairro_nome = t.nome
        bairro_obj = t
        arvores = arvores.filter(geom__intersects=t.geom)
        ocorrencias = ocorrencias.filter(geom__intersects=t.geom)
        inspecoes = inspecoes.filter(arvore__geom__intersects=t.geom)
        tarefas = tarefas.filter(geom__intersects=t.geom)
    if equipe_id := p.get("equipe"):
        equipe = Equipe.objects.filter(pk=uuid_do_parametro(equipe_id, "equipe")).first()
        if equipe is None:
            raise ValidationError({"equipe": ["Equipe não encontrada."]})
        equipe_nome = equipe.nome
        inspecoes = inspecoes.filter(tecnico__in=equipe.membros.all())
        tarefas = tarefas.filter(equipe=equipe)
        ocorrencias = ocorrencias.filter(equipe=equipe)

    no_periodo = Q(realizada_em__date__gte=inicio, realizada_em__date__lte=fim)
    # Período anterior de mesma duração, para a variação dos indicadores "no período".
    duracao = fim - inicio
    fim_anterior = inicio - timedelta(days=1)
    inicio_anterior = fim_anterior - duracao
    no_periodo_anterior = Q(
        realizada_em__date__gte=inicio_anterior, realizada_em__date__lte=fim_anterior
    )
    enviadas = [EstadoInspecao.EM_REVISAO, EstadoInspecao.VALIDADA]
    validas = instantaneos.arvores_validas(arvores)
    inst = instantaneos.calcular(
        arvores, ocorrencias, inspecoes, tarefas, hoje=hoje, agora=timezone.now()
    )
    total_validas = inst["arvores_validas"][0]
    com_especie = inst["especie_confirmada"][0]
    concluidas_periodo = ocorrencias.filter(
        estado=EstadoOcorrencia.CONCLUIDA,
        concluida_em__date__gte=inicio,
        concluida_em__date__lte=fim,
    )
    tempo_medio = concluidas_periodo.aggregate(media=Avg(F("concluida_em") - F("criado_em")))[
        "media"
    ]
    concluidas_anterior = ocorrencias.filter(
        estado=EstadoOcorrencia.CONCLUIDA,
        concluida_em__date__gte=inicio_anterior,
        concluida_em__date__lte=fim_anterior,
    )
    tempo_anterior = concluidas_anterior.aggregate(media=Avg(F("concluida_em") - F("criado_em")))[
        "media"
    ]

    def _dias(t):
        return round(t.total_seconds() / 86400, 1) if t is not None else None

    # Histórico dos instantâneos (M-11): vem dos registros diários do escopo, sem
    # filtro de equipe (os registros são por território). Com filtro de bairro,
    # só os registros daquele território, se estiver no escopo do usuário.
    percentuais = {k for k, (_, den) in inst.items() if den is not None}
    historico: dict[str, dict] = {}
    if not equipe_nome:
        if bairro_obj is None:
            territorios = instantaneos.territorios_do_escopo(usuario)
        elif instantaneos.territorio_no_escopo(usuario, bairro_obj):
            territorios = [bairro_obj]
        else:
            territorios = []
        historico = instantaneos.historico(territorios, inicio, fim, percentuais)

    def ind(
        id_,
        nome,
        definicao,
        formula,
        valor,
        *,
        base=None,
        unidade="",
        periodo=False,
        link=None,
        anterior=None,
    ):
        h = {} if periodo else historico.get(id_, {})
        return {
            # Indicadores do período: valor no período anterior de mesma duração e
            # ``anterior_em`` = início desse período. Instantâneos: valor do último
            # registro diário em ou antes do início do período e a data dele; ``serie``
            # traz até 12 pontos (último registro de cada mês no último ano).
            # Tudo null/vazio quando não se aplica ou não há registros.
            "anterior": h.get("anterior", anterior),
            "anterior_em": h.get("anterior_em", inicio_anterior if periodo else None),
            "serie": h.get("serie", []),
            "id": id_,
            "nome": nome,
            "definicao": definicao,
            "formula": formula,
            "valor": valor,
            "base": base,
            "unidade": unidade,
            "periodo": "selecionado" if periodo else "instantâneo",
            "fonte": FONTE_INTERNA,
            "link": link,
        }

    indicadores = [
        ind(
            "arvores_registros",
            "Árvores cadastradas (registros)",
            "Todos os registros no seu escopo, em qualquer situação.",
            "contagem de registros",
            inst["arvores_registros"][0],
            link={"pagina": "/inventario/arvores", "filtros": {"situacao": "todas"}},
        ),
        ind(
            "arvores_validas",
            "Árvores com registro válido",
            f"Registros {DEFINICAO_VALIDA}.",
            "contagem de registros válidos",
            inst["arvores_validas"][0],
            link={"pagina": "/inventario/arvores", "filtros": {}},
        ),
        ind(
            "especie_confirmada",
            "Espécie confirmada",
            "Percentual de árvores válidas com espécie confirmada por revisor.",
            "confirmadas ÷ válidas × 100",
            _pct(*inst["especie_confirmada"]),
            base=total_validas,
            unidade="%",
            link={"pagina": "/inventario/arvores", "filtros": {"especie_estado": "confirmada"}},
        ),
        ind(
            "com_medidas",
            "Com altura ou DAP",
            "Percentual de árvores válidas com ao menos uma medida de altura ou DAP "
            "aplicada ao cadastro.",
            "com medida ÷ válidas × 100",
            _pct(*inst["com_medidas"]),
            base=total_validas,
            unidade="%",
        ),
        ind(
            "cobertura_inspecao",
            "Inspecionadas nos últimos 12 meses",
            "Percentual de árvores válidas com inspeção validada nos últimos 365 dias.",
            "inspecionadas ÷ válidas × 100",
            _pct(*inst["cobertura_inspecao"]),
            base=total_validas,
            unidade="%",
        ),
        ind(
            "inspecoes_realizadas",
            "Inspeções realizadas",
            "Inspeções enviadas para revisão ou validadas, com data no período.",
            "contagem por data da inspeção",
            inspecoes.filter(no_periodo, estado__in=enviadas).count(),
            periodo=True,
            anterior=inspecoes.filter(no_periodo_anterior, estado__in=enviadas).count(),
            link={"pagina": "/inspecoes", "filtros": {"desde": str(inicio), "ate": str(fim)}},
        ),
        ind(
            "inspecoes_em_revisao",
            "Inspeções aguardando revisão",
            "Inspeções enviadas pelo campo e ainda não validadas ou devolvidas.",
            "contagem",
            inst["inspecoes_em_revisao"][0],
            link={"pagina": "/inspecoes", "filtros": {"estado": "em_revisao"}},
        ),
        ind(
            "tarefas_inspecao_pendentes",
            "Inspeções pendentes (tarefas)",
            "Tarefas de inspeção não concluídas nem canceladas.",
            "contagem",
            inst["tarefas_inspecao_pendentes"][0],
            link={"pagina": "/equipes-tarefas", "filtros": {"tipo": "inspecao_arvore"}},
        ),
        ind(
            "tarefas_atrasadas",
            "Tarefas atrasadas",
            "Tarefas abertas com prazo anterior a hoje.",
            "contagem",
            inst["tarefas_atrasadas"][0],
            link={"pagina": "/equipes-tarefas", "filtros": {"atrasadas": "true"}},
        ),
        ind(
            "ocorrencias_abertas",
            "Ocorrências em aberto",
            "Ocorrências não concluídas nem canceladas. Não inclui alertas ambientais.",
            "contagem",
            inst["ocorrencias_abertas"][0],
            link={"pagina": "/ocorrencias", "filtros": {}},
        ),
        ind(
            "ocorrencias_atrasadas",
            "Ocorrências atrasadas",
            "Ocorrências em aberto com prazo anterior a hoje.",
            "contagem",
            inst["ocorrencias_atrasadas"][0],
            link={"pagina": "/ocorrencias", "filtros": {"atrasadas": "true"}},
        ),
        ind(
            "tempo_atendimento",
            "Tempo médio de atendimento",
            "Média entre registro e conclusão das ocorrências concluídas no período.",
            "média(conclusão − registro), em dias",
            _dias(tempo_medio),
            base=concluidas_periodo.count(),
            unidade="dias",
            periodo=True,
            anterior=_dias(tempo_anterior),
        ),
        ind(
            "ocorrencias_registradas",
            "Ocorrências registradas",
            "Ocorrências registradas no período, em qualquer estado.",
            "contagem por data de registro",
            ocorrencias.filter(criado_em__date__gte=inicio, criado_em__date__lte=fim).count(),
            periodo=True,
            anterior=ocorrencias.filter(
                criado_em__date__gte=inicio_anterior, criado_em__date__lte=fim_anterior
            ).count(),
            link={"pagina": "/ocorrencias", "filtros": {}},
        ),
    ]

    # Série mensal (12 meses até o fim do período): mesmas regras dos indicadores.
    primeiro_mes = date(fim.year - (1 if fim.month < 12 else 0), fim.month % 12 + 1, 1)
    meses = []
    ano, mes = primeiro_mes.year, primeiro_mes.month
    for _ in range(12):
        meses.append(f"{ano:04d}-{mes:02d}")
        ano, mes = (ano + 1, 1) if mes == 12 else (ano, mes + 1)

    def _por_mes(qs, campo):
        contagem = {
            linha["mes"].strftime("%Y-%m"): linha["n"]
            for linha in qs.filter(
                **{f"{campo}__date__gte": primeiro_mes, f"{campo}__date__lte": fim}
            )
            .annotate(mes=TruncMonth(campo))
            .values("mes")
            .annotate(n=Count("id"))
            if linha["mes"]
        }
        return [contagem.get(m, 0) for m in meses]

    series_mensais = {
        "meses": meses,
        "definicao": "Contagens mensais nos 12 meses até o fim do período, no seu escopo e "
        "com os filtros aplicados.",
        "series": [
            {
                "id": "inspecoes",
                "rotulo": "Inspeções realizadas",
                "valores": _por_mes(inspecoes.filter(estado__in=enviadas), "realizada_em"),
            },
            {
                "id": "ocorrencias",
                "rotulo": "Ocorrências registradas",
                "valores": _por_mes(ocorrencias, "criado_em"),
            },
        ],
    }

    # Pendências acionáveis: só o que tem quantidade > 0, cada uma com o link da lista.
    abertas = ocorrencias.exclude(estado__in=ESTADOS_FINAIS)
    candidatas = [
        (
            "risco_confirmado",
            "Ocorrências com risco confirmado em aberto",
            "critica",
            abertas.filter(risco_confirmado=True).count(),
            {"pagina": "/ocorrencias", "filtros": {}},
        ),
        (
            "ocorrencias_atrasadas",
            "Ocorrências com prazo vencido",
            "alta",
            abertas.filter(prazo__lt=hoje).count(),
            {"pagina": "/ocorrencias", "filtros": {"atrasadas": "true"}},
        ),
        (
            "tarefas_atrasadas",
            "Tarefas com prazo vencido",
            "alta",
            tarefas.exclude(estado__in=ESTADOS_FINAIS_TAREFA).filter(prazo__lt=hoje).count(),
            {"pagina": "/equipes-tarefas", "filtros": {"atrasadas": "true"}},
        ),
        (
            "sem_prioridade",
            "Ocorrências em aberto sem prioridade definida",
            "media",
            abertas.filter(prioridade="").count(),
            {"pagina": "/ocorrencias", "filtros": {"prioridade": "sem"}},
        ),
        (
            "inspecoes_em_revisao",
            "Inspeções aguardando revisão",
            "media",
            inspecoes.filter(estado=EstadoInspecao.EM_REVISAO).count(),
            {"pagina": "/inspecoes", "filtros": {"estado": "em_revisao"}},
        ),
    ]
    if usuario.tem_permissao("alertas.ler"):
        candidatas.append(
            (
                "alertas_detectados",
                "Alertas ambientais aguardando triagem",
                "media",
                filtrar_por_escopo(
                    AlertaAmbiental.objects.filter(status=StatusAlerta.DETECTADO), usuario
                ).count(),
                {"pagina": "/alertas", "filtros": {}},
            )
        )
    pendencias = [
        {"id": i, "titulo": t, "gravidade": g, "quantidade": q, "link": link}
        for i, t, g, q, link in candidatas
        if q
    ]

    rotulo_condicao = dict(CondicaoAparente.choices)
    condicoes = (
        validas.values("condicao_aparente").annotate(quantidade=Count("id")).order_by("-quantidade")
    )
    especies = (
        validas.filter(especie_estado=EstadoEspecie.CONFIRMADA)
        .values("especie__nome_cientifico")
        .annotate(quantidade=Count("id"))
        .order_by("-quantidade")[:10]
    )
    rotulo_prioridade = dict(Prioridade.choices)
    prioridades = (
        ocorrencias.exclude(estado__in=ESTADOS_FINAIS)
        .values("prioridade")
        .annotate(quantidade=Count("id"))
        .order_by("-quantidade")
    )
    distribuicoes = {
        "condicao_aparente": {
            "titulo": "Condição aparente registrada",
            "definicao": (
                "Última condição validada de cada árvore válida. Sem inspeção validada, "
                "aparece como “sem avaliação registrada”."
            ),
            "itens": [
                {
                    "rotulo": rotulo_condicao.get(
                        c["condicao_aparente"], "Sem avaliação registrada"
                    )
                    if c["condicao_aparente"]
                    else "Sem avaliação registrada",
                    "quantidade": c["quantidade"],
                }
                for c in condicoes
            ],
        },
        "especies": {
            "titulo": "Espécies confirmadas (10 mais frequentes)",
            "definicao": "Somente identificações confirmadas por revisor.",
            "nao_confirmadas": total_validas - com_especie,
            "itens": [
                {"rotulo": e["especie__nome_cientifico"], "quantidade": e["quantidade"]}
                for e in especies
            ],
        },
        "ocorrencias_prioridade": {
            "titulo": "Ocorrências em aberto por prioridade",
            "definicao": "Prioridade operacional definida pela gestão.",
            "itens": [
                {
                    "rotulo": rotulo_prioridade.get(o["prioridade"], "Sem prioridade definida"),
                    "quantidade": o["quantidade"],
                }
                for o in prioridades
            ],
        },
    }

    equipes = []
    if usuario.tem_permissao("tarefas.ler"):
        for e in Equipe.objects.filter(ativa=True).prefetch_related("membros"):
            if equipe_nome and e.nome != equipe_nome:
                continue
            t = tarefas.filter(equipe=e)
            equipes.append(
                {
                    "equipe": e.nome,
                    "tarefas_abertas": t.exclude(estado__in=ESTADOS_FINAIS_TAREFA).count(),
                    "tarefas_atrasadas": t.exclude(estado__in=ESTADOS_FINAIS_TAREFA)
                    .filter(prazo__lt=hoje)
                    .count(),
                    "tarefas_concluidas_periodo": t.filter(
                        concluida_em__date__gte=inicio, concluida_em__date__lte=fim
                    ).count(),
                    "inspecoes_periodo": inspecoes.filter(no_periodo, tecnico__in=e.membros.all())
                    .exclude(estado=EstadoInspecao.RASCUNHO)
                    .count(),
                }
            )

    modelos = [
        m
        for m in ENTIDADES
        if m.startswith(("inventario.", "ocorrencias.", "inspecoes.", "tarefas."))
    ]
    atividades = (
        Events.objects.across(*modelos).order_by("-pgh_created_at", "-pgh_id")[:10]
        if modelos
        else []
    )

    return Response(
        {
            "periodo": {"inicio": inicio, "fim": fim},
            "filtros": {"bairro": bairro_nome, "equipe": equipe_nome},
            "calculado_em": timezone.now(),
            "indicadores": indicadores,
            # Fontes externas ficam fora de ``indicadores``: não são da operação
            # e não passam pelo filtro de equipe (o dado é por bairro).
            "contexto_externo": externos.contexto_externo(usuario, bairro_obj),
            "distribuicoes": distribuicoes,
            "series_mensais": series_mensais,
            "pendencias": pendencias,
            "equipes": equipes,
            "atividades": EventoAuditoriaSerializer(atividades, many=True).data
            # A trilha não é filtrada por escopo: só quem consulta a auditoria a vê.
            if usuario.tem_permissao("admin.auditoria")
            else [],
        }
    )
