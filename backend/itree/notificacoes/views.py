from django.db.models import Case, Count, F, IntegerField, Max, Q, When
from django.db.models.functions import TruncDate
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .models import GRUPOS, Notificacao, TipoNotificacao
from .serializers import (
    ContagemNaoLidasSerializer,
    GrupoNotificacoesSerializer,
    LerGrupoSerializer,
    NotificacaoSerializer,
)

LIMITE_GRUPOS = 50


def _plural(n: int, singular: str, plural: str) -> str:
    return f"{n} {singular if n == 1 else plural}"


@extend_schema_view(
    list=extend_schema(
        operation_id="notificacoes_listar",
        parameters=[
            OpenApiParameter("tipo", str, description="Um tipo de notificação."),
            OpenApiParameter("lida", bool, description="true = só lidas; false = só não lidas."),
        ],
    ),
)
class NotificacaoViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Notificações do próprio usuário (RF-SHELL-002). Não lidas primeiro."""

    serializer_class = NotificacaoSerializer
    lookup_value_converter = "uuid"

    def _proprias(self):
        return Notificacao.objects.filter(usuario=self.request.user)

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Notificacao.objects.none()
        qs = self._proprias().order_by(F("lida_em").asc(nulls_first=True), "-criado_em", "-id")
        if self.action != "list":
            return qs
        p = self.request.query_params
        if tipo := p.get("tipo"):
            if tipo not in TipoNotificacao.values:
                raise ValidationError(
                    {"tipo": [f"Use um de: {', '.join(TipoNotificacao.values)}."]}
                )
            qs = qs.filter(tipo=tipo)
        if (lida := p.get("lida")) in ("true", "false"):
            qs = qs.filter(lida_em__isnull=lida == "false")
        elif lida:
            raise ValidationError({"lida": ["Use true ou false."]})
        return qs

    @extend_schema(operation_id="notificacoes_contar", responses=ContagemNaoLidasSerializer)
    @action(detail=False, pagination_class=None)
    def contagem(self, request):
        return Response({"nao_lidas": self._proprias().filter(lida_em__isnull=True).count()})

    @extend_schema(
        operation_id="notificacoes_agrupadas",
        parameters=[OpenApiParameter("limite", int, description="Máximo de grupos (padrão 8).")],
        responses=GrupoNotificacoesSerializer(many=True),
    )
    @action(detail=False, pagination_class=None)
    def agrupadas(self, request):
        """Eventos do mesmo tipo no mesmo dia viram um item ("5 inspeções aguardando revisão").

        Grupos com não lidas vêm primeiro; dentro de cada faixa, o mais recente antes.
        """
        try:
            limite = min(int(request.query_params.get("limite", 8)), LIMITE_GRUPOS)
        except ValueError:
            raise ValidationError({"limite": ["Informe um número inteiro."]}) from None
        linhas = (
            self._proprias()
            .annotate(dia=TruncDate("criado_em"))
            .values("tipo", "dia")
            .annotate(
                quantidade=Count("id"),
                nao_lidas=Count("id", filter=Q(lida_em__isnull=True)),
                tem_nao_lida=Max(
                    Case(When(lida_em__isnull=True, then=1), default=0, output_field=IntegerField())
                ),
                ultima_em=Max("criado_em"),
            )
            .order_by("-tem_nao_lida", "-ultima_em")[: max(limite, 1)]
        )
        grupos = []
        for g in linhas:
            ultima = (
                self._proprias()
                .annotate(dia=TruncDate("criado_em"))
                .filter(tipo=g["tipo"], dia=g["dia"])
                .order_by("-criado_em", "-id")
                .first()
            )
            link_lista = GRUPOS[g["tipo"]][2]
            unica = g["quantidade"] == 1
            grupos.append(
                {
                    "tipo": g["tipo"],
                    "dia": g["dia"],
                    "quantidade": g["quantidade"],
                    "nao_lidas": g["nao_lidas"],
                    "lida": g["nao_lidas"] == 0,
                    "titulo": ultima.titulo if unica else _plural_grupo(g["quantidade"], g["tipo"]),
                    "texto": ultima.texto if unica else "",
                    "link": (ultima.link if unica else link_lista),
                    "ultima_em": g["ultima_em"],
                }
            )
        return Response(GrupoNotificacoesSerializer(grupos, many=True).data)

    @extend_schema(
        operation_id="notificacoes_ler_grupo",
        request=LerGrupoSerializer,
        responses=ContagemNaoLidasSerializer,
    )
    @action(detail=False, methods=["post"], url_path="ler-grupo", pagination_class=None)
    def ler_grupo(self, request):
        dados = LerGrupoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        agora = timezone.now()
        (
            self._proprias()
            .annotate(dia=TruncDate("criado_em"))
            .filter(
                tipo=dados.validated_data["tipo"],
                dia=dados.validated_data["dia"],
                lida_em__isnull=True,
            )
            .update(lida_em=agora, atualizado_em=agora)
        )
        return Response({"nao_lidas": self._proprias().filter(lida_em__isnull=True).count()})

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
        self._proprias().filter(lida_em__isnull=True).update(lida_em=agora, atualizado_em=agora)
        return Response({"nao_lidas": 0})


def _plural_grupo(n: int, tipo: str) -> str:
    singular, plural, _ = GRUPOS[tipo]
    return _plural(n, singular, plural)
