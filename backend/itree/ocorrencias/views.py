import re

import pghistory
from django.db import transaction
from django.db.models import Case, F, IntegerField, Q, When
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from pghistory.models import Events
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from itree.auditoria.views import EventoAuditoriaSerializer
from itree.contas.acesso import filtrar_por_escopo, ponto_no_escopo, requer
from itree.contas.permissoes import Permissao
from itree.core.lote import (
    OperacaoEmLoteSerializer,
    PrazoEmLoteSerializer,
    ResultadoAcaoEmLoteSerializer,
    iniciar_acao_em_lote,
)
from itree.core.parametros import uuid_do_parametro
from itree.notificacoes import servicos as notificacoes

from .models import (
    ESTADOS_FINAIS,
    TRANSICOES,
    EstadoOcorrencia,
    Ocorrencia,
    OrigemOcorrencia,
    Prioridade,
    TipoOcorrencia,
)
from .serializers import (
    OcorrenciaSerializer,
    PrioridadeEmLoteSerializer,
    PrioridadeSerializer,
    ReatribuicaoEmLoteSerializer,
    RiscoSerializer,
    TipoOcorrenciaSerializer,
    TransicaoSerializer,
)

P = Permissao


def ocorrencias_do_escopo(usuario):
    """Ocorrências que o usuário enxerga, com o que a lista e as ações em lote precisam."""
    qs = Ocorrencia.objects.select_related(
        "tipo",
        "arvore",
        "bairro",
        "responsavel",
        "equipe",
        "registrada_por",
        "prioridade_definida_por",
        "risco_responsavel",
        "inspecao",
        "alerta",
    ).prefetch_related("tarefas", "tarefas__responsavel")
    return filtrar_por_escopo(qs, usuario)


def encerrar_tarefas_da_ocorrencia(ocorrencia, estado, autor=None):
    """Ao encerrar a ocorrência, as tarefas de atendimento abertas acompanham."""
    from itree.tarefas.models import ESTADOS_FINAIS_TAREFA, EstadoTarefa

    final = (
        EstadoTarefa.CONCLUIDA if estado == EstadoOcorrencia.CONCLUIDA else EstadoTarefa.CANCELADA
    )
    for tarefa in ocorrencia.tarefas.exclude(estado__in=ESTADOS_FINAIS_TAREFA):
        tarefa.estado = final
        tarefa.concluida_em = timezone.now() if final == EstadoTarefa.CONCLUIDA else None
        tarefa.motivo_estado = f"Encerrada junto com a ocorrência {ocorrencia.codigo}."
        tarefa.save(update_fields=["estado", "concluida_em", "motivo_estado", "atualizado_em"])
        notificacoes.tarefa_concluida_ou_bloqueada(tarefa, autor=autor)


@extend_schema_view(
    list=extend_schema(
        operation_id="tipos_ocorrencia_listar", parameters=[OpenApiParameter("ativo", bool)]
    ),
    create=extend_schema(operation_id="tipos_ocorrencia_criar"),
    partial_update=extend_schema(operation_id="tipos_ocorrencia_atualizar"),
)
class TipoOcorrenciaViewSet(
    mixins.ListModelMixin, mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet
):
    serializer_class = TipoOcorrenciaSerializer
    http_method_names = ["get", "post", "patch"]
    pagination_class = None

    def get_permissions(self):
        if self.action == "list":
            return [requer(P.OCORRENCIAS_LER)()]
        return [requer(P.ADMIN_CONFIGURACAO)()]

    def get_queryset(self):
        qs = TipoOcorrencia.objects.all()
        if (ativo := self.request.query_params.get("ativo")) in ("true", "false"):
            qs = qs.filter(ativo=ativo == "true")
        return qs


FILTROS = [
    OpenApiParameter("busca", str, description="Código (OCO-000123), descrição ou endereço."),
    OpenApiParameter(
        "estado", str, description="Um ou mais, separados por vírgula. 'abertas' = não finais."
    ),
    OpenApiParameter("tipo", str),
    OpenApiParameter("prioridade", str, description="Use 'sem' para ocorrências sem prioridade."),
    OpenApiParameter("bairro", str),
    OpenApiParameter("equipe", str),
    OpenApiParameter("responsavel", str),
    OpenApiParameter("arvore", str),
    OpenApiParameter("atrasadas", bool),
    OpenApiParameter("origem", str),
    OpenApiParameter(
        "ordenar",
        str,
        description="'urgencia': prazo mais próximo primeiro (sem prazo por último), depois "
        "prioridade; padrão: mais recentes primeiro.",
    ),
]


def ordenar_ocorrencias(qs, p):
    if p.get("ordenar") != "urgencia":
        return qs
    peso = Case(
        When(prioridade=Prioridade.URGENTE, then=0),
        When(prioridade=Prioridade.ALTA, then=1),
        When(prioridade=Prioridade.MEDIA, then=2),
        When(prioridade=Prioridade.BAIXA, then=3),
        default=4,
        output_field=IntegerField(),
    )
    return qs.order_by(F("prazo").asc(nulls_last=True), peso, "-numero")


def filtrar_ocorrencias(qs, p):
    if busca := p.get("busca", "").strip():
        if m := re.fullmatch(r"(?i)(?:oco-?)?0*(\d+)", busca):
            qs = qs.filter(numero=int(m.group(1)))
        else:
            qs = qs.filter(Q(descricao__icontains=busca) | Q(endereco__icontains=busca))
    if estado := p.get("estado"):
        if estado == "abertas":
            qs = qs.exclude(estado__in=ESTADOS_FINAIS)
        else:
            qs = qs.filter(estado__in=estado.split(","))
    if prioridade := p.get("prioridade"):
        qs = qs.filter(prioridade="" if prioridade == "sem" else prioridade)
    for campo in ("tipo", "bairro", "equipe", "responsavel", "arvore"):
        if valor := p.get(campo):
            qs = qs.filter(**{f"{campo}_id": uuid_do_parametro(valor, campo)})
    if origem := p.get("origem"):
        qs = qs.filter(origem=origem)
    if p.get("atrasadas") == "true":
        qs = qs.exclude(estado__in=ESTADOS_FINAIS).filter(prazo__lt=timezone.localdate())
    return qs


@extend_schema_view(
    list=extend_schema(operation_id="ocorrencias_listar", parameters=FILTROS),
    retrieve=extend_schema(operation_id="ocorrencias_obter"),
    create=extend_schema(operation_id="ocorrencias_criar"),
    partial_update=extend_schema(operation_id="ocorrencias_atualizar"),
)
class OcorrenciaViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Ocorrências (W-04). Alertas ambientais não aparecem aqui até serem convertidos."""

    serializer_class = OcorrenciaSerializer
    http_method_names = ["get", "post", "patch"]
    lookup_value_converter = "uuid"

    def get_permissions(self):
        mapa = {
            "list": P.OCORRENCIAS_LER,
            "retrieve": P.OCORRENCIAS_LER,
            "historico": P.OCORRENCIAS_LER,
            "prioridade": P.OCORRENCIAS_PRIORIZAR,
            "prioridade_em_lote": P.OCORRENCIAS_PRIORIZAR,
            "risco": P.OCORRENCIAS_CONFIRMAR_RISCO,
        }
        return [requer(mapa.get(self.action, P.OCORRENCIAS_EDITAR))()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # geração do contrato OpenAPI
            return Ocorrencia.objects.none()
        qs = ocorrencias_do_escopo(self.request.user)
        if self.action == "list":
            qs = ordenar_ocorrencias(
                filtrar_ocorrencias(qs, self.request.query_params), self.request.query_params
            )
        return qs

    def _verificar_arvore(self, serializer):
        arvore = serializer.validated_data.get("arvore")
        if arvore is not None and (
            arvore.geom is None or not ponto_no_escopo(self.request.user, arvore.geom)
        ):
            raise ValidationError({"arvore_id": ["A árvore está fora do seu escopo territorial."]})

    def perform_create(self, serializer):
        geom = serializer.validated_data["geom"]
        self._verificar_arvore(serializer)
        if not ponto_no_escopo(self.request.user, geom):
            raise ValidationError(
                {"localizacao": ["A localização está fora do seu escopo territorial."]}
            )
        serializer.save(origem=OrigemOcorrencia.WEB, registrada_por=self.request.user)

    def perform_update(self, serializer):
        if serializer.instance.estado in ESTADOS_FINAIS:
            raise ValidationError("Ocorrências concluídas ou canceladas não podem ser editadas.")
        self._verificar_arvore(serializer)
        if "geom" in serializer.validated_data and not ponto_no_escopo(
            self.request.user, serializer.validated_data["geom"]
        ):
            raise ValidationError(
                {"localizacao": ["A localização está fora do seu escopo territorial."]}
            )
        with pghistory.context(motivo=self.request.data.get("motivo") or None):
            serializer.save()

    def _responder(self, request):
        return Response(OcorrenciaSerializer(self.get_object(), context={"request": request}).data)

    @extend_schema(
        operation_id="ocorrencias_transicao",
        request=TransicaoSerializer,
        responses=OcorrenciaSerializer,
    )
    @action(detail=True, methods=["post"])
    def transicao(self, request, pk=None):
        """Muda o estado conforme o fluxo (RF-OCO-004). Cancelar exige justificativa."""
        ocorrencia = self.get_object()
        dados = TransicaoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        novo, motivo = (
            dados.validated_data["estado"],
            dados.validated_data.get("motivo", "").strip(),
        )
        permitido = novo in TRANSICOES.get(ocorrencia.estado, set()) or (
            novo == EstadoOcorrencia.CANCELADA and ocorrencia.estado not in ESTADOS_FINAIS
        )
        if not permitido:
            raise ValidationError(
                {
                    "estado": f"Não é possível ir de '{ocorrencia.get_estado_display()}' "
                    "para esse estado."
                }
            )
        if novo == EstadoOcorrencia.CANCELADA and not motivo:
            raise ValidationError({"motivo": "Informe a justificativa do cancelamento."})
        with pghistory.context(motivo=motivo or None):
            ocorrencia.estado = novo
            ocorrencia.concluida_em = timezone.now() if novo == EstadoOcorrencia.CONCLUIDA else None
            ocorrencia.save(update_fields=["estado", "concluida_em", "atualizado_em"])
            if novo in ESTADOS_FINAIS:
                encerrar_tarefas_da_ocorrencia(ocorrencia, novo, autor=request.user)
        return self._responder(request)

    @extend_schema(
        operation_id="ocorrencias_prioridade",
        request=PrioridadeSerializer,
        responses=OcorrenciaSerializer,
    )
    @action(detail=True, methods=["post"])
    def prioridade(self, request, pk=None):
        """Prioridade operacional, definida pela gestão (W-04 §2)."""
        ocorrencia = self.get_object()
        dados = PrioridadeSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        if ocorrencia.estado in ESTADOS_FINAIS:
            raise ValidationError("A ocorrência já foi encerrada.")
        with pghistory.context(motivo=dados.validated_data.get("motivo") or None):
            ocorrencia.prioridade = dados.validated_data["prioridade"]
            ocorrencia.prioridade_definida_por = request.user
            ocorrencia.prioridade_definida_em = timezone.now()
            ocorrencia.save(
                update_fields=[
                    "prioridade",
                    "prioridade_definida_por",
                    "prioridade_definida_em",
                    "atualizado_em",
                ]
            )
        return self._responder(request)

    @extend_schema(
        operation_id="ocorrencias_reatribuir_em_lote",
        request=ReatribuicaoEmLoteSerializer,
        responses={200: ResultadoAcaoEmLoteSerializer, 202: OperacaoEmLoteSerializer},
    )
    @action(detail=False, methods=["post"], url_path="lote/reatribuir", pagination_class=None)
    def reatribuir_em_lote(self, request):
        """Muda responsável e/ou equipe das ocorrências marcadas na lista (até o limite do lote)."""
        dados = ReatribuicaoEmLoteSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        v = dados.validated_data
        # `null` limpa o campo; o que não veio no corpo não muda.
        parametros = {
            chave: str(v[chave].pk) if v[chave] else None
            for chave in ("responsavel_id", "equipe_id")
            if chave in v
        }
        return iniciar_acao_em_lote(request.user, "ocorrencias", "reatribuir", v, parametros)

    @extend_schema(
        operation_id="ocorrencias_prioridade_em_lote",
        request=PrioridadeEmLoteSerializer,
        responses={200: ResultadoAcaoEmLoteSerializer, 202: OperacaoEmLoteSerializer},
    )
    @action(detail=False, methods=["post"], url_path="lote/prioridade", pagination_class=None)
    def prioridade_em_lote(self, request):
        """Define a prioridade operacional das ocorrências marcadas (só a gestão)."""
        dados = PrioridadeEmLoteSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        v = dados.validated_data
        return iniciar_acao_em_lote(
            request.user, "ocorrencias", "prioridade", v, {"prioridade": v["prioridade"]}
        )

    @extend_schema(
        operation_id="ocorrencias_prazo_em_lote",
        request=PrazoEmLoteSerializer,
        responses={200: ResultadoAcaoEmLoteSerializer, 202: OperacaoEmLoteSerializer},
    )
    @action(detail=False, methods=["post"], url_path="lote/prazo", pagination_class=None)
    def prazo_em_lote(self, request):
        """Define (ou remove) o prazo das ocorrências marcadas ou de todas as filtradas."""
        dados = PrazoEmLoteSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        v = dados.validated_data
        prazo = v["prazo"].isoformat() if v["prazo"] else None
        return iniciar_acao_em_lote(request.user, "ocorrencias", "prazo", v, {"prazo": prazo})

    @extend_schema(
        operation_id="ocorrencias_risco", request=RiscoSerializer, responses=OcorrenciaSerializer
    )
    @action(detail=True, methods=["post"])
    def risco(self, request, pk=None):
        """Registra risco confirmado por responsável técnico habilitado (RF-OCO-006)."""
        ocorrencia = self.get_object()
        dados = RiscoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        if ocorrencia.risco_confirmado:
            raise ValidationError("O risco desta ocorrência já foi registrado.")
        with (
            transaction.atomic(),
            pghistory.context(registro_profissional=request.user.registro_profissional),
        ):
            ocorrencia.risco_confirmado = True
            ocorrencia.risco_descricao = dados.validated_data["descricao"]
            ocorrencia.risco_responsavel = request.user
            ocorrencia.risco_registrado_em = timezone.now()
            ocorrencia.save(
                update_fields=[
                    "risco_confirmado",
                    "risco_descricao",
                    "risco_responsavel",
                    "risco_registrado_em",
                    "atualizado_em",
                ]
            )
            notificacoes.risco_confirmado(ocorrencia, autor=request.user)
        return self._responder(request)

    @extend_schema(
        operation_id="ocorrencias_historico", responses=EventoAuditoriaSerializer(many=True)
    )
    @action(detail=True, pagination_class=None)
    def historico(self, request, pk=None):
        """Histórico de encaminhamentos (RF-OCO-005)."""
        ocorrencia = self.get_object()
        eventos = Events.objects.references(ocorrencia).order_by("-pgh_created_at", "-pgh_id")[:500]
        return Response(EventoAuditoriaSerializer(eventos, many=True).data)
