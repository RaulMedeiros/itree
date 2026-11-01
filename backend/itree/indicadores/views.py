"""Visão geral (W-06). Todo indicador declara definição, fórmula, base, período
e fonte. Ausência de dados é ``null``, nunca zero (RN-VG-001)."""

from datetime import date, timedelta

from django.db.models import Avg, Count, F, Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from pghistory.models import Events
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from itree.auditoria.views import ENTIDADES, EventoAuditoriaSerializer
from itree.contas.acesso import filtrar_por_escopo
from itree.contas.models import Equipe
from itree.core.parametros import uuid_do_parametro
from itree.inspecoes.models import CondicaoAparente, EstadoInspecao, Inspecao
from itree.inventario.models import Arvore, EstadoEspecie, Medida, SituacaoArvore, TipoMedida
from itree.ocorrencias.models import ESTADOS_FINAIS, EstadoOcorrencia, Ocorrencia, Prioridade
from itree.tarefas.models import ESTADOS_FINAIS_TAREFA, Tarefa, TipoTarefa
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
        "distribuicoes": serializers.DictField(),
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

    bairro_nome = equipe_nome = None
    if bairro := p.get("bairro"):
        t = Territorio.objects.filter(pk=uuid_do_parametro(bairro, "bairro")).first()
        if t is None:
            raise ValidationError({"bairro": ["Território não encontrado."]})
        bairro_nome = t.nome
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
    validas = arvores.filter(situacao=SituacaoArvore.ATIVA, geom__isnull=False).exclude(
        localizacao_origem=""
    )
    total_validas = validas.count()
    com_especie = validas.filter(especie_estado=EstadoEspecie.CONFIRMADA).count()
    com_medidas = validas.filter(
        pk__in=Medida.objects.filter(
            aplicada=True, tipo__in=[TipoMedida.ALTURA, TipoMedida.DAP]
        ).values("arvore_id")
    ).count()
    inspecionadas_12m = validas.filter(
        ultima_inspecao_em__gte=timezone.now() - timedelta(days=365)
    ).count()
    concluidas_periodo = ocorrencias.filter(
        estado=EstadoOcorrencia.CONCLUIDA,
        concluida_em__date__gte=inicio,
        concluida_em__date__lte=fim,
    )
    tempo_medio = concluidas_periodo.aggregate(media=Avg(F("concluida_em") - F("criado_em")))[
        "media"
    ]
    tarefas_inspecao_abertas = tarefas.filter(tipo=TipoTarefa.INSPECAO_ARVORE).exclude(
        estado__in=ESTADOS_FINAIS_TAREFA
    )

    def ind(
        id_, nome, definicao, formula, valor, *, base=None, unidade="", periodo=False, link=None
    ):
        return {
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
            arvores.count(),
            link={"pagina": "/inventario/arvores", "filtros": {"situacao": "todas"}},
        ),
        ind(
            "arvores_validas",
            "Árvores com registro válido",
            f"Registros {DEFINICAO_VALIDA}.",
            "contagem de registros válidos",
            total_validas,
            link={"pagina": "/inventario/arvores", "filtros": {}},
        ),
        ind(
            "especie_confirmada",
            "Espécie confirmada",
            "Percentual de árvores válidas com espécie confirmada por revisor.",
            "confirmadas ÷ válidas × 100",
            _pct(com_especie, total_validas),
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
            _pct(com_medidas, total_validas),
            base=total_validas,
            unidade="%",
        ),
        ind(
            "cobertura_inspecao",
            "Inspecionadas nos últimos 12 meses",
            "Percentual de árvores válidas com inspeção validada nos últimos 365 dias.",
            "inspecionadas ÷ válidas × 100",
            _pct(inspecionadas_12m, total_validas),
            base=total_validas,
            unidade="%",
        ),
        ind(
            "inspecoes_realizadas",
            "Inspeções realizadas",
            "Inspeções enviadas para revisão ou validadas, com data no período.",
            "contagem por data da inspeção",
            inspecoes.filter(
                no_periodo, estado__in=[EstadoInspecao.EM_REVISAO, EstadoInspecao.VALIDADA]
            ).count(),
            periodo=True,
            link={"pagina": "/inspecoes", "filtros": {"desde": str(inicio), "ate": str(fim)}},
        ),
        ind(
            "inspecoes_em_revisao",
            "Inspeções aguardando revisão",
            "Inspeções enviadas pelo campo e ainda não validadas ou devolvidas.",
            "contagem",
            inspecoes.filter(estado=EstadoInspecao.EM_REVISAO).count(),
            link={"pagina": "/inspecoes", "filtros": {"estado": "em_revisao"}},
        ),
        ind(
            "tarefas_inspecao_pendentes",
            "Inspeções pendentes (tarefas)",
            "Tarefas de inspeção não concluídas nem canceladas.",
            "contagem",
            tarefas_inspecao_abertas.count(),
            link={"pagina": "/equipes-tarefas", "filtros": {"tipo": "inspecao_arvore"}},
        ),
        ind(
            "tarefas_atrasadas",
            "Tarefas atrasadas",
            "Tarefas abertas com prazo anterior a hoje.",
            "contagem",
            tarefas.exclude(estado__in=ESTADOS_FINAIS_TAREFA).filter(prazo__lt=hoje).count(),
            link={"pagina": "/equipes-tarefas", "filtros": {"atrasadas": "true"}},
        ),
        ind(
            "ocorrencias_abertas",
            "Ocorrências em aberto",
            "Ocorrências não concluídas nem canceladas. Não inclui alertas ambientais.",
            "contagem",
            ocorrencias.exclude(estado__in=ESTADOS_FINAIS).count(),
            link={"pagina": "/ocorrencias", "filtros": {}},
        ),
        ind(
            "ocorrencias_atrasadas",
            "Ocorrências atrasadas",
            "Ocorrências em aberto com prazo anterior a hoje.",
            "contagem",
            ocorrencias.exclude(estado__in=ESTADOS_FINAIS).filter(prazo__lt=hoje).count(),
            link={"pagina": "/ocorrencias", "filtros": {"atrasadas": "true"}},
        ),
        ind(
            "tempo_atendimento",
            "Tempo médio de atendimento",
            "Média entre registro e conclusão das ocorrências concluídas no período.",
            "média(conclusão − registro), em dias",
            round(tempo_medio.total_seconds() / 86400, 1) if tempo_medio is not None else None,
            base=concluidas_periodo.count(),
            unidade="dias",
            periodo=True,
        ),
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
            "distribuicoes": distribuicoes,
            "equipes": equipes,
            "atividades": EventoAuditoriaSerializer(atividades, many=True).data
            # A trilha não é filtrada por escopo: só quem consulta a auditoria a vê.
            if usuario.tem_permissao("admin.auditoria")
            else [],
        }
    )
