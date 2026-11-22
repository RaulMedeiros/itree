"""API da iluminação pública: resumo da camada (fonte, licença e volume) e árvores a até o raio
provisório de conflito de um poste. A camada em si é servida como MVT pelo app ``mapa``."""

from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.request import Request
from rest_framework.response import Response

from itree.contas.acesso import filtrar_por_escopo, requer
from itree.contas.permissoes import Permissao
from itree.inventario.models import Arvore
from itree.inventario.serializers import ArvoreResumoSerializer
from itree.inventario.views import filtrar_arvores

from . import servico
from .models import PontoIluminacao
from .serializers import PosteProximoSerializer, ResumoIluminacaoSerializer


class ArvoreProximaIluminacaoSerializer(ArvoreResumoSerializer):
    poste = PosteProximoSerializer(read_only=True, allow_null=True)

    class Meta(ArvoreResumoSerializer.Meta):
        fields = [*ArvoreResumoSerializer.Meta.fields, "poste"]


def altura_do_parametro(params) -> float | None:
    bruto = params.get("altura_poste_max_m")
    if not bruto:
        return None
    try:
        return float(bruto)
    except ValueError:
        raise ValidationError(
            {"altura_poste_max_m": ["Informe a altura máxima da faixa, em m."]}
        ) from None


def arvores_do_conflito(usuario, params):
    """Árvores ativas do escopo do usuário perto da iluminação, com os filtros da lista."""
    arvores = filtrar_por_escopo(Arvore.objects.select_related("especie", "bairro"), usuario)
    arvores = filtrar_arvores(arvores, {k: v for k, v in params.items() if k != "situacao"})
    return servico.arvores_em_conflito(arvores, altura_max_m=altura_do_parametro(params))


@extend_schema_view(
    get=extend_schema(
        operation_id="iluminacao_arvores_proximas",
        parameters=[
            OpenApiParameter("bairro", str, description="Bairro (id) da árvore."),
            OpenApiParameter(
                "altura_poste_max_m",
                float,
                description="Só postes cuja faixa de altura termina neste valor (5 a 25).",
            ),
            OpenApiParameter("busca", str, description="Código ou endereço da árvore."),
        ],
        responses=ArvoreProximaIluminacaoSerializer(many=True),
    )
)
class ArvoresProximasView(ListAPIView):
    """Árvores ativas a até R metros de um ponto de iluminação pública (R provisório).

    Só proximidade: não afirma conflito, dano nem risco. A regra é decisão da URBFOR e da
    SEINF (docs/decisoes/pendentes.md). Restrito ao escopo territorial de quem consulta.
    """

    permission_classes = [requer(Permissao.INVENTARIO_LER)]
    serializer_class = ArvoreProximaIluminacaoSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # geração do contrato OpenAPI
            return Arvore.objects.none()
        return arvores_do_conflito(self.request.user, self.request.query_params)

    def paginate_queryset(self, queryset):
        pagina = super().paginate_queryset(queryset)
        if pagina is None:
            return pagina
        pontos = PontoIluminacao.objects.in_bulk([a.poste_id for a in pagina if a.poste_id])
        for arvore in pagina:
            ponto = pontos.get(arvore.poste_id)
            arvore.poste = (
                servico.dados_do_poste(ponto, arvore.poste_distancia_m) if ponto else None
            )
        return pagina


@extend_schema(operation_id="iluminacao_resumo", responses=ResumoIluminacaoSerializer)
@api_view(["GET"])
def resumo(request: Request):
    """Fonte e data dos pontos de iluminação e o raio provisório do conflito com as árvores."""
    if not request.user.tem_permissao("inventario.ler"):
        raise PermissionDenied()
    dados = servico.resumo_da_iluminacao()
    return Response(
        {
            "importada": dados is not None,
            "quantidade": dados["quantidade"] if dados else 0,
            "fonte": dados["fonte"] if dados else "",
            "fonte_url": dados["fonte_url"] if dados else "",
            "licenca": dados["licenca"] if dados else "",
            "data_referencia": dados["data_referencia"] if dados else None,
            "ingerido_em": dados["ingerido_em"] if dados else None,
            "raio_conflito_m": servico.raio_de_conflito_m(),
            "raio_provisorio": True,
            "alturas_maximas_m": [float(a) for a in servico.ALTURAS_MAXIMAS_M],
        }
    )
