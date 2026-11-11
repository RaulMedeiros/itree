from django.db.models import F
from django.utils import timezone
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Notificacao
from .serializers import ContagemNaoLidasSerializer, NotificacaoSerializer


@extend_schema_view(
    list=extend_schema(operation_id="notificacoes_listar"),
)
class NotificacaoViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Notificações do próprio usuário (RF-SHELL-002). Não lidas primeiro."""

    serializer_class = NotificacaoSerializer
    lookup_value_converter = "uuid"

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Notificacao.objects.none()
        return Notificacao.objects.filter(usuario=self.request.user).order_by(
            F("lida_em").asc(nulls_first=True), "-criado_em", "-id"
        )

    @extend_schema(operation_id="notificacoes_contar", responses=ContagemNaoLidasSerializer)
    @action(detail=False, pagination_class=None)
    def contagem(self, request):
        return Response({"nao_lidas": self.get_queryset().filter(lida_em__isnull=True).count()})

    @extend_schema(operation_id="notificacoes_ler", request=None, responses=NotificacaoSerializer)
    @action(detail=True, methods=["post"])
    def ler(self, request, pk=None):
        notificacao = self.get_object()
        if notificacao.lida_em is None:
            notificacao.lida_em = timezone.now()
            notificacao.save(update_fields=["lida_em", "atualizado_em"])
        return Response(NotificacaoSerializer(notificacao).data)

    @extend_schema(
        operation_id="notificacoes_ler_todas", request=None, responses=ContagemNaoLidasSerializer
    )
    @action(detail=False, methods=["post"], url_path="ler-todas", pagination_class=None)
    def ler_todas(self, request):
        agora = timezone.now()
        self.get_queryset().filter(lida_em__isnull=True).update(lida_em=agora, atualizado_em=agora)
        return Response({"nao_lidas": 0})
