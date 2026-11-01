import re

import pghistory
from django.db import transaction
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
from itree.core.parametros import uuid_do_parametro
from itree.inventario.models import Arvore, SituacaoArvore
from itree.inventario.views import filtrar_arvores
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
    ResultadoLoteSerializer,
    TarefasEmLoteSerializer,
    TarefaSerializer,
    TransicaoTarefaSerializer,
)

P = Permissao
LIMITE_LOTE = 1000

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


def _verificar_escopo_responsavel(tarefa_geom, responsavel):
    if responsavel is not None and not ponto_no_escopo(responsavel, tarefa_geom):
        raise ValidationError(
            {
                "responsavel_id": [
                    "O local da tarefa está fora do escopo territorial do responsável."
                ]
            }
        )


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
        qs = Tarefa.objects.select_related(
            "arvore", "ocorrencia", "responsavel", "equipe", "criada_por"
        )
        qs = filtrar_por_escopo(qs, self.request.user)
        if self.action != "list":
            return qs
        p = self.request.query_params
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
                responsavel=self.request.user
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

    def _pode_atuar(self, tarefa) -> bool:
        return pode_atuar(self.request.user, tarefa)

    def perform_create(self, serializer):
        geom = serializer.validated_data["geom"]
        if not ponto_no_escopo(self.request.user, geom):
            raise ValidationError({"alvo": ["O alvo está fora do seu escopo territorial."]})
        _verificar_escopo_responsavel(geom, serializer.validated_data.get("responsavel"))
        serializer.save(criada_por=self.request.user)

    def perform_update(self, serializer):
        tarefa = serializer.instance
        if tarefa.estado in ESTADOS_FINAIS_TAREFA:
            raise ValidationError("Tarefas concluídas ou canceladas não podem ser alteradas.")
        if "responsavel" in serializer.validated_data:
            _verificar_escopo_responsavel(tarefa.geom, serializer.validated_data["responsavel"])
        with pghistory.context(motivo=self.request.data.get("motivo") or None):
            serializer.save()

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
        with pghistory.context(motivo=motivo or None):
            tarefa.estado = novo
            tarefa.motivo_estado = motivo
            tarefa.concluida_em = timezone.now() if novo == EstadoTarefa.CONCLUIDA else None
            tarefa.save(update_fields=["estado", "motivo_estado", "concluida_em", "atualizado_em"])
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
                Tarefa.objects.create(
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
                criadas += 1
        return Response(
            {
                "criadas": criadas,
                "ignoradas": len(com_tarefa_aberta),
                "fora_do_escopo_do_responsavel": fora,
            },
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(operation_id="tarefas_historico", responses=EventoAuditoriaSerializer(many=True))
    @action(detail=True, pagination_class=None)
    def historico(self, request, pk=None):
        tarefa = self.get_object()
        eventos = Events.objects.references(tarefa).order_by("-pgh_created_at", "-pgh_id")[:500]
        return Response(EventoAuditoriaSerializer(eventos, many=True).data)
