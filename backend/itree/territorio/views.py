import json

from django.contrib.gis.db.models.functions import AsGeoJSON, PointOnSurface
from django.core.exceptions import ValidationError
from django.db.models import Count, IntegerField, OuterRef, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.response import Response

from itree.contas.acesso import filtrar_por_escopo
from itree.inventario.models import Arvore, SituacaoArvore

from . import ficha
from .models import Territorio, TipoTerritorio
from .serializers import FichaSerializer, TerritorioSerializer

PARAMETROS = [
    OpenApiParameter("tipo", str, description="municipio | regional | bairro"),
    OpenApiParameter("busca", str, description="Parte do nome."),
]


def com_arvores_no_escopo(qs, usuario):
    """Árvores ativas dentro do território e do escopo de quem consulta."""
    arvores = (
        filtrar_por_escopo(
            Arvore.objects.filter(situacao=SituacaoArvore.ATIVA, geom__intersects=OuterRef("geom")),
            usuario,
        )
        .order_by()
        .values("situacao")
        .annotate(n=Count("pk"))
        .values("n")
    )
    return qs.annotate(
        arvores_no_escopo=Coalesce(Subquery(arvores, output_field=IntegerField()), 0)
    )


@extend_schema_view(
    list=extend_schema(operation_id="territorios_listar", parameters=PARAMETROS),
    retrieve=extend_schema(operation_id="territorios_obter"),
)
class TerritorioViewSet(viewsets.ReadOnlyModelViewSet):
    """Limites territoriais. São dados públicos de referência: qualquer usuário
    autenticado pode consultá-los, independentemente do escopo."""

    serializer_class = TerritorioSerializer

    def get_queryset(self):
        qs = Territorio.objects.select_related("pai")
        if self.action == "list":
            qs = com_arvores_no_escopo(qs, self.request.user)
        if tipo := self.request.query_params.get("tipo"):
            qs = qs.filter(tipo=tipo)
        if busca := self.request.query_params.get("busca"):
            qs = qs.filter(nome__icontains=busca)
        return qs

    @extend_schema(
        operation_id="territorios_geojson",
        parameters=[
            *PARAMETROS,
            OpenApiParameter("precisao", int, description="Casas decimais (padrão 6)."),
        ],
        responses={(200, "application/geo+json"): OpenApiTypes.OBJECT},
    )
    @action(detail=False, pagination_class=None)
    def geojson(self, request: Request) -> Response:
        """FeatureCollection com fonte e data em cada feição (RN-PROV-003)."""
        try:
            precisao = min(max(int(request.query_params.get("precisao", 6)), 1), 8)
        except ValueError:
            precisao = 6
        qs = self.get_queryset().annotate(
            geometria=AsGeoJSON("geom", precision=precisao), rotulo=PointOnSurface("geom")
        )
        feicoes = [
            {
                "type": "Feature",
                "id": str(t.id),
                "geometry": json.loads(t.geometria),
                "properties": {
                    "nome": t.nome,
                    "tipo": t.tipo,
                    "codigo": t.codigo,
                    "fonte": t.fonte,
                    "fonte_url": t.fonte_url,
                    "data_referencia": t.data_referencia,
                    "ingerido_em": t.ingerido_em,
                    # Ponto garantidamente dentro do polígono, para o nome no mapa.
                    "rotulo": [round(t.rotulo.x, 6), round(t.rotulo.y, 6)],
                },
            }
            for t in qs
        ]
        return Response({"type": "FeatureCollection", "features": feicoes})


class PodeVerBairros(BasePermission):
    """Mesma regra do painel da visão geral: análises ou inventário."""

    message = "Você não tem permissão para esta ação."

    def has_permission(self, request, view) -> bool:
        u = request.user
        return bool(
            u
            and u.is_authenticated
            and (u.tem_permissao("relatorios.ler") or u.tem_permissao("inventario.ler"))
        )


@extend_schema_view(list=extend_schema(operation_id="bairros_listar", parameters=[PARAMETROS[1]]))
class BairroViewSet(viewsets.GenericViewSet):
    """Bairros do escopo de quem consulta e a ficha de cada um."""

    queryset = Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO)  # tipo do id no contrato
    serializer_class = TerritorioSerializer
    pagination_class = None
    permission_classes = [PodeVerBairros]

    def _do_escopo(self):
        from itree.indicadores.atencao import bairros_do_escopo

        return bairros_do_escopo(self.request.user)

    def list(self, request: Request) -> Response:
        """Os bairros do escopo, com a regional e as árvores ativas de cada um."""
        qs = com_arvores_no_escopo(self._do_escopo().select_related("pai"), request.user)
        if busca := request.query_params.get("busca"):
            qs = qs.filter(nome__icontains=busca)
        return Response(TerritorioSerializer(qs.order_by("nome"), many=True).data)

    @extend_schema(operation_id="bairros_ficha", responses=FichaSerializer)
    @action(detail=True, methods=["get"])
    def ficha(self, request: Request, pk: str) -> Response:
        """Tudo o que a plataforma sabe do bairro, com fonte e data de cada bloco. Quem não
        tem o bairro no escopo recebe 403."""
        bairros = Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO)
        try:
            existe = bairros.filter(pk=pk).exists()
        except (ValueError, ValidationError):
            existe = False
        if not existe:
            raise NotFound("Bairro não encontrado.")
        bairro = ficha.bairros_para_ficha(self._do_escopo().filter(pk=pk)).first()
        if bairro is None:
            raise PermissionDenied("Este bairro está fora do seu escopo.")
        agora = timezone.now()
        return Response(
            ficha.montar(bairro, request.user, hoje=timezone.localdate(agora), agora=agora)
        )
