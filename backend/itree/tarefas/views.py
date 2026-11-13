import re

import pghistory
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from pghistory.models import Events
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from itree.auditoria.views import EventoAuditoriaSerializer
from itree.contas.acesso import area_do_escopo, filtrar_por_escopo, ponto_no_escopo, requer
from itree.contas.permissoes import Permissao
from itree.core.lote import (
    OperacaoEmLoteSerializer,
    PrazoEmLoteSerializer,
    ResultadoAcaoEmLoteSerializer,
    iniciar_acao_em_lote,
)
from itree.core.parametros import LIMITE_LOTE, uuid_do_parametro
from itree.evidencias.models import EstadoEvidencia, Evidencia
from itree.inventario.models import Arvore, SituacaoArvore
from itree.inventario.views import filtrar_arvores
from itree.notificacoes import servicos as notificacoes
from itree.territorio.models import Territorio

from .acesso import pode_atuar
from .models import (
    ESTADOS_FINAIS_TAREFA,
    EXIGEM_MOTIVO,
    TRANSICOES_TAREFA,
    EstadoTarefa,
    Tarefa,
    TipoTarefa,
)
from .serializers import (
    EquipeEmLoteSerializer,
    ResultadoLoteSerializer,
    TarefasEmLoteSerializer,
    TarefaSerializer,
    TransicaoTarefaSerializer,
)

P = Permissao

FILTROS = [
    OpenApiParameter("busca", str, description="Código (TAR-000123)"),
    OpenApiParameter(
        "estado", str, description="'abertas' (padrão), 'todas' ou lista separada por vírgula"
    ),
    OpenApiParameter("tipo", str),
    OpenApiParameter("responsavel", str, description="ID do usuário ou 'eu'"),
    OpenApiParameter("equipe", str),
    OpenApiParameter("bairro", str),
    OpenApiParameter("arvore", str),
    OpenApiParameter("ocorrencia", str),
    OpenApiParameter("atrasadas", bool),
]


def filtrar_tarefas(qs, usuario, p):
    """Filtros da listagem de tarefas, compartilhados com a exportação."""
    if busca := p.get("busca", "").strip():
        if m := re.fullmatch(r"(?i)(?:tar-?)?0*(\d+)", busca):
            qs = qs.filter(numero=int(m.group(1)))
    estado = p.get("estado", "abertas")
    if estado == "abertas":
        qs = qs.exclude(estado__in=ESTADOS_FINAIS_TAREFA)
    elif estado != "todas":
        qs = qs.filter(estado__in=estado.split(","))
    if tipo := p.get("tipo"):
        qs = qs.filter(tipo=tipo)
    if responsavel := p.get("responsavel"):
        qs = qs.filter(
            responsavel=usuario
            if responsavel == "eu"
            else uuid_do_parametro(responsavel, "responsavel")
        )
    for campo in ("equipe", "arvore", "ocorrencia"):
        if valor := p.get(campo):
            qs = qs.filter(**{f"{campo}_id": uuid_do_parametro(valor, campo)})
    if bairro := p.get("bairro"):
        area = (
            Territorio.objects.filter(pk=uuid_do_parametro(bairro, "bairro"))
            .values_list("geom", flat=True)
            .first()
        )
        qs = qs.filter(geom__intersects=area) if area else qs.none()
    if p.get("atrasadas") == "true":
        qs = qs.exclude(estado__in=ESTADOS_FINAIS_TAREFA).filter(prazo__lt=timezone.localdate())
    return qs


def _exigir_resultado_e_evidencia(tarefa, resultado: str) -> None:
    """Regras de conclusão (M-20): o resultado é sempre pedido; nos tipos de execução em
    campo (`TIPOS_COM_EVIDENCIA_OBRIGATORIA`), também ao menos uma foto anexada à tarefa."""
    erros: dict[str, list[str]] = {}
    if not resultado:
        erros["resultado"] = ["Descreva o que foi feito."]
    if (
        tarefa.exige_evidencia
        and not Evidencia.objects.filter(
            tarefa=tarefa, estado=EstadoEvidencia.DISPONIVEL, tipo_conteudo__startswith="image/"
        ).exists()
    ):
        erros["evidencias"] = ["Anexe ao menos uma foto do serviço executado para concluir."]
    if erros:
        raise ValidationError(erros)


def _verificar_escopo_responsavel(tarefa_geom, responsavel):
    if responsavel is not None and not ponto_no_escopo(responsavel, tarefa_geom):
        raise ValidationError(
            {
                "responsavel_id": [
                    "O local da tarefa está fora do escopo territorial do responsável."
                ]
            }
        )


def tarefas_do_escopo(usuario):
    """Tarefas que o usuário enxerga, com o que a lista e as ações em lote precisam."""
    qs = Tarefa.objects.select_related(
        "arvore",
        "ocorrencia",
        "ocorrencia__inspecao",
        "responsavel",
        "equipe",
        "criada_por",
    )
    return filtrar_por_escopo(qs, usuario)


@extend_schema_view(
    list=extend_schema(operation_id="tarefas_listar", parameters=FILTROS),
    retrieve=extend_schema(operation_id="tarefas_obter"),
    create=extend_schema(operation_id="tarefas_criar"),
    partial_update=extend_schema(operation_id="tarefas_atualizar"),
)
class TarefaViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Tarefas de campo (W-07)."""

    serializer_class = TarefaSerializer
    http_method_names = ["get", "post", "patch"]
    lookup_value_converter = "uuid"

    def get_permissions(self):
        if self.action in ("list", "retrieve", "historico"):
            return [requer(P.TAREFAS_LER)()]
        if self.action == "transicao":
            return [requer(P.TAREFAS_LER)()]  # o responsável também atualiza o andamento
        return [requer(P.TAREFAS_EDITAR)()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Tarefa.objects.none()
        qs = tarefas_do_escopo(self.request.user)
        if self.action in ("list", "retrieve"):
            # A lista e o detalhe mostram quantas evidências cada tarefa já tem.
            qs = qs.annotate(
                total_evidencias=Count(
                    "evidencias", filter=Q(evidencias__estado=EstadoEvidencia.DISPONIVEL)
                )
            ).order_by(*Tarefa._meta.ordering)  # a agregação descarta a ordenação do modelo
        if self.action != "list":
            return qs
        return filtrar_tarefas(qs, self.request.user, self.request.query_params)

    def _pode_atuar(self, tarefa) -> bool:
        return pode_atuar(self.request.user, tarefa)

    def perform_create(self, serializer):
        geom = serializer.validated_data["geom"]
        if not ponto_no_escopo(self.request.user, geom):
            raise ValidationError({"alvo": ["O alvo está fora do seu escopo territorial."]})
        _verificar_escopo_responsavel(geom, serializer.validated_data.get("responsavel"))
        with transaction.atomic():
            tarefa = serializer.save(criada_por=self.request.user)
            notificacoes.tarefa_atribuida(tarefa, autor=self.request.user)

    def perform_update(self, serializer):
        tarefa = serializer.instance
        if tarefa.estado in ESTADOS_FINAIS_TAREFA:
            raise ValidationError("Tarefas concluídas ou canceladas não podem ser alteradas.")
        if "responsavel" in serializer.validated_data:
            _verificar_escopo_responsavel(tarefa.geom, serializer.validated_data["responsavel"])
        with (
            transaction.atomic(),
            pghistory.context(motivo=self.request.data.get("motivo") or None),
        ):
            anterior = (tarefa.equipe_id, tarefa.responsavel_id)
            tarefa = serializer.save()
            if (tarefa.equipe_id, tarefa.responsavel_id) != anterior:
                notificacoes.tarefa_atribuida(tarefa, autor=self.request.user)

    @extend_schema(
        operation_id="tarefas_transicao",
        request=TransicaoTarefaSerializer,
        responses=TarefaSerializer,
    )
    @action(detail=True, methods=["post"])
    def transicao(self, request, pk=None):
        tarefa = self.get_object()
        if not self._pode_atuar(tarefa):
            raise ValidationError(
                "Só o responsável, a equipe ou a coordenação podem mudar o andamento."
            )
        dados = TransicaoTarefaSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        novo, motivo = (
            dados.validated_data["estado"],
            dados.validated_data.get("motivo", "").strip(),
        )
        if novo not in TRANSICOES_TAREFA.get(tarefa.estado, set()):
            raise ValidationError({"estado": ["Transição não permitida a partir do estado atual."]})
        if novo in EXIGEM_MOTIVO and not motivo:
            raise ValidationError({"motivo": ["Informe o motivo."]})
        if tarefa.estado == EstadoTarefa.BLOQUEADA and not motivo:
            raise ValidationError({"motivo": ["Informe por que o bloqueio acabou."]})
        resultado = dados.validated_data.get("resultado", "").strip()
        if novo == EstadoTarefa.CONCLUIDA:
            _exigir_resultado_e_evidencia(tarefa, resultado)
        with transaction.atomic(), pghistory.context(motivo=motivo or None):
            tarefa.estado = novo
            tarefa.motivo_estado = motivo
            campos = ["estado", "motivo_estado", "concluida_em", "atualizado_em"]
            if novo == EstadoTarefa.CONCLUIDA:
                tarefa.resultado = resultado
                campos.append("resultado")
            tarefa.concluida_em = timezone.now() if novo == EstadoTarefa.CONCLUIDA else None
            tarefa.save(update_fields=campos)
            notificacoes.tarefa_concluida_ou_bloqueada(tarefa, autor=request.user)
        return Response(TarefaSerializer(tarefa).data)

    @extend_schema(
        operation_id="tarefas_criar_em_lote",
        request=TarefasEmLoteSerializer,
        responses={201: ResultadoLoteSerializer},
    )
    @action(detail=False, methods=["post"], url_path="lote", pagination_class=None)
    def lote(self, request):
        """Uma tarefa de inspeção por árvore selecionada (IDs ou filtros do inventário)."""
        dados = TarefasEmLoteSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        v = dados.validated_data
        arvores = filtrar_por_escopo(
            Arvore.objects.filter(situacao=SituacaoArvore.ATIVA, geom__isnull=False), request.user
        )
        if v["arvore_ids"]:
            arvores = arvores.filter(pk__in=v["arvore_ids"])
        elif v["filtros_arvores"]:
            arvores = filtrar_arvores(arvores, {**v["filtros_arvores"], "situacao": "ativa"})
        else:
            raise ValidationError("Informe as árvores ou os filtros.")
        total = arvores.count()
        if total > LIMITE_LOTE:
            raise ValidationError(
                f"A seleção tem {total} árvores; o limite por lote é {LIMITE_LOTE}."
            )
        com_tarefa_aberta = set(
            Tarefa.objects.filter(tipo=TipoTarefa.INSPECAO_ARVORE, arvore__in=arvores)
            .exclude(estado__in=ESTADOS_FINAIS_TAREFA)
            .values_list("arvore_id", flat=True)
        )
        responsavel = v.get("responsavel_id")
        area_responsavel = area_do_escopo(responsavel) if responsavel else None
        criadas = fora = 0
        with transaction.atomic(), pghistory.context(evento="tarefas_em_lote"):
            for arvore in arvores:
                if arvore.pk in com_tarefa_aberta:
                    continue
                if responsavel and (
                    area_responsavel is None or not area_responsavel.intersects(arvore.geom)
                ):
                    fora += 1
                    continue
                nova = Tarefa.objects.create(
                    tipo=TipoTarefa.INSPECAO_ARVORE,
                    arvore=arvore,
                    geom=arvore.geom,
                    responsavel=responsavel,
                    equipe=v.get("equipe_id"),
                    prazo=v.get("prazo"),
                    prioridade=v.get("prioridade", ""),
                    descricao=v.get("descricao", ""),
                    criada_por=request.user,
                )
                notificacoes.tarefa_atribuida(nova, autor=request.user)
                criadas += 1
        return Response(
            {
                "criadas": criadas,
                "ignoradas": len(com_tarefa_aberta),
                "fora_do_escopo_do_responsavel": fora,
            },
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        operation_id="tarefas_equipe_em_lote",
        request=EquipeEmLoteSerializer,
        responses={200: ResultadoAcaoEmLoteSerializer, 202: OperacaoEmLoteSerializer},
    )
    @action(detail=False, methods=["post"], url_path="lote/equipe", pagination_class=None)
    def equipe_em_lote(self, request):
        """Passa as tarefas marcadas na lista para outra equipe (até o limite do lote).

        O responsável só continua se for membro da nova equipe; senão a tarefa fica sem
        responsável, para a equipe escolher quem atende. Cada tarefa avisa a nova equipe.
        """
        dados = EquipeEmLoteSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        v = dados.validated_data
        return iniciar_acao_em_lote(
            request.user, "tarefas", "equipe", v, {"equipe_id": str(v["equipe_id"].pk)}
        )

    @extend_schema(
        operation_id="tarefas_prazo_em_lote",
        request=PrazoEmLoteSerializer,
        responses={200: ResultadoAcaoEmLoteSerializer, 202: OperacaoEmLoteSerializer},
    )
    @action(detail=False, methods=["post"], url_path="lote/prazo", pagination_class=None)
    def prazo_em_lote(self, request):
        """Define (ou remove) o prazo das tarefas marcadas ou de todas as filtradas."""
        dados = PrazoEmLoteSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        v = dados.validated_data
        prazo = v["prazo"].isoformat() if v["prazo"] else None
        return iniciar_acao_em_lote(request.user, "tarefas", "prazo", v, {"prazo": prazo})

    @extend_schema(operation_id="tarefas_historico", responses=EventoAuditoriaSerializer(many=True))
    @action(detail=True, pagination_class=None)
    def historico(self, request, pk=None):
        tarefa = self.get_object()
        eventos = Events.objects.references(tarefa).order_by("-pgh_created_at", "-pgh_id")[:500]
        return Response(EventoAuditoriaSerializer(eventos, many=True).data)
