import pghistory
from django.db.models import Q
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from .acesso import requer
from .models import Equipe, Usuario
from .permissoes import Permissao
from .serializers import EquipeSerializer, EuSerializer, UsuarioAdminSerializer


@extend_schema(operation_id="eu", responses=EuSerializer)
@api_view(["GET"])
def eu(request: Request) -> Response:
    """Usuário autenticado, papéis, permissões efetivas e escopo territorial."""
    usuario = Usuario.objects.prefetch_related("territorios").get(pk=request.user.pk)
    return Response(EuSerializer(usuario).data)


class ComMotivoMixin:
    """Registra o ``motivo`` enviado pelo cliente no contexto de auditoria."""

    def perform_create(self, serializer):
        with pghistory.context(motivo=self.request.data.get("motivo") or None):
            serializer.save()

    def perform_update(self, serializer):
        with pghistory.context(motivo=self.request.data.get("motivo") or None):
            serializer.save()


@extend_schema_view(
    list=extend_schema(
        operation_id="usuarios_listar",
        parameters=[
            OpenApiParameter("busca", str, description="Nome ou e-mail."),
            OpenApiParameter("papel", str),
            OpenApiParameter("ativo", bool),
        ],
    ),
    retrieve=extend_schema(operation_id="usuarios_obter"),
    create=extend_schema(operation_id="usuarios_criar"),
    partial_update=extend_schema(operation_id="usuarios_atualizar"),
)
class UsuarioAdminViewSet(
    ComMotivoMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Administração de usuários (W-10). Usuários não são excluídos; são
    desativados, preservando autoria dos registros (RF-ADM-001)."""

    serializer_class = UsuarioAdminSerializer
    permission_classes = [requer(Permissao.ADMIN_USUARIOS)]
    http_method_names = ["get", "post", "patch"]

    def get_queryset(self):
        qs = Usuario.objects.prefetch_related("territorios", "equipes")
        params = self.request.query_params
        if busca := params.get("busca"):
            qs = qs.filter(Q(nome__icontains=busca) | Q(email__icontains=busca))
        if papel := params.get("papel"):
            qs = qs.filter(papeis__contains=[papel])
        if (ativo := params.get("ativo")) in ("true", "false"):
            qs = qs.filter(is_active=ativo == "true")
        return qs


@extend_schema_view(
    list=extend_schema(
        operation_id="equipes_listar",
        parameters=[OpenApiParameter("ativa", bool)],
    ),
    retrieve=extend_schema(operation_id="equipes_obter"),
    create=extend_schema(operation_id="equipes_criar"),
    partial_update=extend_schema(operation_id="equipes_atualizar"),
)
class EquipeViewSet(
    ComMotivoMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Equipes e membros (W-10). Equipes são desativadas, não excluídas."""

    serializer_class = EquipeSerializer
    http_method_names = ["get", "post", "patch"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [requer(Permissao.TAREFAS_LER)()]
        return [requer(Permissao.ADMIN_EQUIPES)()]

    def get_queryset(self):
        qs = Equipe.objects.select_related("coordenador").prefetch_related("membros", "territorios")
        if (ativa := self.request.query_params.get("ativa")) in ("true", "false"):
            qs = qs.filter(ativa=ativa == "true")
        return qs
