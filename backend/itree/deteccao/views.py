"""API da detecção automática, em ``/api/v1/deteccoes``.

Recebe lotes (JSON, multipart ou pacote ZIP) com token de integração ou pessoa autorizada,
lista lotes e sinais de possível remoção, entrega os pontos de plantio e administra os tokens.
O contrato de dados está em docs/integracoes/deteccao-automatica.md."""

import json

from django.contrib.gis.db.models.functions import AsGeoJSON
from django.core.exceptions import RequestDataTooBig, TooManyFilesSent
from django.db.models import Count
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import (
    OpenApiParameter,
    extend_schema,
    extend_schema_view,
    inline_serializer,
)
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.response import Response

from itree.contas.acesso import filtrar_por_escopo, requer, tem_escopo_municipal
from itree.contas.autenticacao import OIDCAuthentication
from itree.contas.permissoes import Permissao as P
from itree.core.parametros import uuid_do_parametro

from . import pacote, servico
from .autenticacao import TokenIntegracaoAuthentication
from .contrato import ErroContrato
from .models import (
    CanalLote,
    LoteDeteccao,
    PontoPlantio,
    SinalRemocao,
    SituacaoPontoPlantio,
    SituacaoSinal,
    TokenIntegracao,
)
from .serializers import (
    DecisaoRemocaoSerializer,
    LoteDeteccaoDetalheSerializer,
    LoteDeteccaoSerializer,
    SinalRemocaoSerializer,
    TokenCriadoSerializer,
    TokenIntegracaoSerializer,
)


class CorpoGrandeDemais(APIException):
    status_code = 413
    default_detail = (
        "Envio grande demais para multipart: mande 'dados' como arquivo (não como campo), "
        "divida o lote ou use o pacote ZIP (POST /deteccoes/lotes/pacote)."
    )
    default_code = "corpo_grande_demais"


class CorpoGrande(APIException):
    status_code = 413
    default_detail = "O envio passa do limite de tamanho."


class ErroDeContrato(APIException):
    status_code = 422
    default_detail = "O envio não obedece ao contrato de dados."

    def __init__(self, mensagens: list[str]):
        super().__init__(detail={"detail": self.default_detail, "erros": mensagens})


class LoteJaExiste(APIException):
    status_code = 409
    default_detail = "Lote já recebido."


class ArmazenamentoIndisponivel(APIException):
    status_code = 503
    default_detail = "O armazenamento de arquivos não está configurado neste ambiente."


def _token(request) -> TokenIntegracao | None:
    return request.auth if isinstance(request.auth, TokenIntegracao) else None


def permite(permissao: str, *, token_le_os_proprios: bool = False) -> type[BasePermission]:
    """Token de integração vale pelas permissões do próprio token; pessoa, pelas dos papéis.
    ``token_le_os_proprios``: o token também pode consultar os lotes que enviou."""

    class _Permite(BasePermission):
        message = "Você não tem permissão para esta ação."

        def has_permission(self, request, view) -> bool:
            token = _token(request)
            if token is not None:
                return token.tem_permissao(P.DETECCAO_ENVIAR) and (
                    permissao == P.DETECCAO_ENVIAR or token_le_os_proprios
                )
            usuario = request.user
            return bool(usuario and usuario.is_authenticated and usuario.tem_permissao(permissao))

    return _Permite


def _erros(exc: ErroContrato):
    raise ErroDeContrato(exc.mensagens)


@extend_schema_view(
    list=extend_schema(
        operation_id="deteccoes_lotes_listar",
        parameters=[OpenApiParameter("situacao", str), OpenApiParameter("sensor", str)],
    ),
    retrieve=extend_schema(operation_id="deteccoes_lotes_obter"),
)
class LoteDeteccaoViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """Lotes de detecção automática. O envio aceita token de integração (``Authorization: Token``)
    ou pessoa com ``deteccao.enviar`` (``Bearer``); a leitura é de quem tem ``deteccao.ler``."""

    authentication_classes = [TokenIntegracaoAuthentication, OIDCAuthentication]
    lookup_value_converter = "uuid"

    def get_permissions(self):
        if self.action in ("create", "pacote"):
            return [permite(P.DETECCAO_ENVIAR)()]
        if self.action == "retrieve":
            return [permite(P.DETECCAO_LER, token_le_os_proprios=True)()]
        return [permite(P.DETECCAO_LER)()]

    def get_serializer_class(self):
        return (
            LoteDeteccaoDetalheSerializer if self.action == "retrieve" else LoteDeteccaoSerializer
        )

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return LoteDeteccao.objects.none()
        qs = LoteDeteccao.objects.select_related("enviado_por", "integracao")
        token = _token(self.request)
        if token is not None:
            return qs.filter(integracao=token)
        if not tem_escopo_municipal(self.request.user):
            qs = qs.filter(enviado_por=self.request.user)
        if self.action == "list":
            p = self.request.query_params
            if situacao := p.get("situacao"):
                qs = qs.filter(situacao=situacao)
            if sensor := p.get("sensor"):
                qs = qs.filter(sensor=sensor)
        return qs

    def _envio(self, request, canal, arquivo_nome="") -> servico.Envio:
        return servico.Envio(
            canal=canal,
            usuario=request.user,
            integracao=_token(request),
            arquivo_nome=arquivo_nome,
        )

    @staticmethod
    def _conferir_tamanho(request) -> None:
        from django.conf import settings

        try:
            tamanho = int(request.META.get("CONTENT_LENGTH") or 0)
        except ValueError:
            tamanho = 0
        if tamanho > settings.DETECCAO_MAX_CORPO_MB * 1024 * 1024:
            raise CorpoGrande(f"O envio passa do limite de {settings.DETECCAO_MAX_CORPO_MB} MB.")

    @staticmethod
    def _resposta(lote: LoteDeteccao) -> Response:
        dados = LoteDeteccaoDetalheSerializer(lote).data
        em_fila = lote.situacao in ("recebido", "em_processamento")
        return Response(
            dados, status=status.HTTP_202_ACCEPTED if em_fila else status.HTTP_201_CREATED
        )

    @extend_schema(
        operation_id="deteccoes_lotes_enviar",
        request={
            "application/json": inline_serializer(
                "EnvioLoteDeteccao",
                {
                    "lote": serializers.DictField(
                        help_text="id, projeto_origem, versao_modelo, sensor, capturado_em e "
                        "area_coberta (GeoJSON, opcional)."
                    ),
                    "deteccoes": serializers.ListField(child=serializers.DictField()),
                },
            ),
            "multipart/form-data": inline_serializer(
                "EnvioLoteDeteccaoMultipart",
                {
                    "dados": serializers.FileField(
                        help_text="O mesmo JSON do envio simples, como arquivo ou campo."
                    ),
                },
            ),
        },
        responses={
            201: LoteDeteccaoDetalheSerializer,
            202: LoteDeteccaoDetalheSerializer,
        },
    )
    def create(self, request: Request) -> Response:
        """Recebe um lote de detecções. Até o limite síncrono, processa na hora (201); lotes
        grandes vão para a fila (202) e a situação é consultada em ``GET /deteccoes/lotes/{id}``.
        Em multipart, as fotos seguem como arquivos e são citadas por ``arquivo``."""
        self._conferir_tamanho(request)
        fotos = {}
        if request.content_type and request.content_type.startswith("multipart/"):
            try:
                bruto = request.FILES.get("dados")
                texto = bruto.read().decode("utf-8-sig") if bruto else request.data.get("dados", "")
            except (RequestDataTooBig, TooManyFilesSent) as exc:
                # Sem isto o Django devolve um 400 em HTML, sem motivo para o integrador.
                raise CorpoGrandeDemais() from exc
            try:
                corpo = json.loads(texto)
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise ValidationError({"dados": "JSON inválido."}) from None
            fotos = pacote.fotos_do_multipart(
                f for nome, lista in request.FILES.lists() if nome != "dados" for f in lista
            )
        else:
            corpo = request.data
        if not isinstance(corpo, dict):
            raise ErroDeContrato(["O corpo precisa ser um objeto com 'lote' e 'deteccoes'."])
        return self._enviar(
            lambda: servico.enviar(
                corpo.get("lote"),
                corpo.get("deteccoes"),
                self._envio(request, CanalLote.API),
                fotos,
            )
        )

    def _enviar(self, executar) -> Response:
        try:
            return self._resposta(executar())
        except ErroContrato as exc:
            _erros(exc)
        except servico.LoteJaRecebido as exc:
            raise LoteJaExiste(str(exc)) from exc
        except servico.ArmazenamentoNaoConfigurado as exc:
            raise ArmazenamentoIndisponivel() from exc

    @extend_schema(
        operation_id="deteccoes_lotes_enviar_pacote",
        request={
            "multipart/form-data": inline_serializer(
                "EnvioPacoteDeteccao", {"arquivo": serializers.FileField()}
            )
        },
        responses={201: LoteDeteccaoDetalheSerializer, 202: LoteDeteccaoDetalheSerializer},
    )
    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser], url_path="pacote")
    def pacote(self, request: Request) -> Response:
        """Pacote ZIP: ``lote.json``, ``deteccoes.geojson`` ou ``deteccoes.gpkg`` e as fotos."""
        self._conferir_tamanho(request)
        arquivo = request.FILES.get("arquivo")
        if arquivo is None:
            raise ValidationError({"arquivo": "Envie o pacote ZIP."})
        if not arquivo.name.lower().endswith(".zip"):
            raise ValidationError({"arquivo": "O pacote precisa ser um arquivo .zip."})
        return self._enviar(
            lambda: servico.enviar_pacote(
                arquivo.read(), self._envio(request, CanalLote.PACOTE, arquivo.name[:255])
            )
        )

    @extend_schema(
        operation_id="deteccoes_lotes_mapa",
        responses={(200, "application/geo+json"): OpenApiTypes.OBJECT},
    )
    @action(detail=True, pagination_class=None)
    def mapa(self, request: Request, pk=None) -> Response:
        """Detecções do lote como GeoJSON, com o resultado de cada uma (criada, juntada, ponto de
        plantio, recusada ou possível remoção)."""
        lote = self.get_object()
        features = []

        def ponto(geom, **props):
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [geom.x, geom.y]},
                    "properties": props,
                }
            )

        for o in lote.observacoes.select_related("arvore"):
            ponto(
                o.geom,
                resultado="criada" if o.resultado == "criou" else "juntada",
                id=o.id_deteccao,
                arvore=str(o.arvore_id),
                codigo=o.arvore.codigo,
                confianca=o.confianca,
            )
        for p in lote.pontos_plantio.all():
            ponto(
                p.geom,
                resultado="ponto_plantio",
                id=p.id_deteccao,
                tipo=p.tipo,
                confianca=p.confianca,
            )
        for s in lote.sinais_remocao.select_related("arvore"):
            if s.arvore.geom:
                ponto(
                    s.arvore.geom,
                    resultado="possivel_remocao",
                    id=s.arvore.codigo,
                    arvore=str(s.arvore_id),
                    codigo=s.arvore.codigo,
                )
        for e in lote.erros:
            if "longitude" in e and "latitude" in e:
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [e["longitude"], e["latitude"]],
                        },
                        "properties": {
                            "resultado": "recusada",
                            "id": e["id"],
                            "motivo": e["motivo"],
                        },
                    }
                )
        return Response({"type": "FeatureCollection", "features": features})


@extend_schema_view(
    list=extend_schema(
        operation_id="deteccoes_remocoes_listar",
        parameters=[
            OpenApiParameter(
                "situacao", str, description="Padrão: pendente. 'todas' inclui as demais."
            ),
            OpenApiParameter("lote", str),
        ],
    ),
)
class SinalRemocaoViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Possíveis remoções: árvore conhecida que um lote, cobrindo a área, não viu. Nada é removido
    sozinho; confirmar a remoção exclui logicamente a árvore, com justificativa."""

    serializer_class = SinalRemocaoSerializer
    lookup_value_converter = "uuid"

    def get_permissions(self):
        if self.action == "list":
            return [requer(P.DETECCAO_LER)()]
        return [requer(P.DETECCAO_REVISAR)()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return SinalRemocao.objects.none()
        qs = SinalRemocao.objects.select_related(
            "arvore", "arvore__especie", "arvore__bairro", "lote"
        )
        qs = filtrar_por_escopo(qs, self.request.user, campo_geom="arvore__geom")
        if self.action == "list":
            p = self.request.query_params
            situacao = p.get("situacao", "pendente")
            if situacao != "todas":
                qs = qs.filter(situacao=situacao)
            if lote := p.get("lote"):
                qs = qs.filter(lote_id=uuid_do_parametro(lote, "lote"))
        return qs.order_by("-criado_em", "arvore__numero")

    def _decidir(self, request, confirmar: bool) -> Response:
        sinal = self.get_object()
        dados = DecisaoRemocaoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        try:
            sinal = servico.decidir_remocao(
                sinal, request.user, confirmar, dados.validated_data["motivo"]
            )
        except servico.ErroRevisao as exc:
            raise ValidationError(str(exc)) from exc
        return Response(SinalRemocaoSerializer(sinal).data)

    @extend_schema(
        operation_id="deteccoes_remocoes_confirmar",
        request=DecisaoRemocaoSerializer,
        responses=SinalRemocaoSerializer,
    )
    @action(detail=True, methods=["post"])
    def confirmar(self, request, pk=None):
        """Confirma a remoção: a árvore é excluída (exclusão lógica, auditada)."""
        return self._decidir(request, True)

    @extend_schema(
        operation_id="deteccoes_remocoes_descartar",
        request=DecisaoRemocaoSerializer,
        responses=SinalRemocaoSerializer,
    )
    @action(detail=True, methods=["post"])
    def descartar(self, request, pk=None):
        """Descarta o sinal: a árvore continua no inventário."""
        return self._decidir(request, False)


@extend_schema(
    operation_id="deteccoes_pontos_plantio",
    responses={(200, "application/geo+json"): OpenApiTypes.OBJECT},
)
@api_view(["GET"])
@permission_classes([requer(P.MAPA_LER, P.DETECCAO_LER)])
def pontos_plantio(request: Request) -> Response:
    """Pontos de plantio possível (berços vazios e tocos vistos por detecção), no escopo."""
    qs = filtrar_por_escopo(
        PontoPlantio.objects.filter(situacao=SituacaoPontoPlantio.ABERTO), request.user
    )
    linhas = (
        qs.annotate(geometria=AsGeoJSON("geom", precision=6))
        .values("id", "tipo", "contexto", "confianca", "capturado_em", "geometria")
        .order_by("-capturado_em")[:20_000]
    )
    return Response(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": str(linha["id"]),
                    "geometry": json.loads(linha["geometria"]),
                    "properties": {
                        "tipo": linha["tipo"],
                        "contexto": linha["contexto"],
                        "confianca": linha["confianca"],
                        "capturado_em": linha["capturado_em"].isoformat(),
                    },
                }
                for linha in linhas
            ],
        }
    )


@extend_schema_view(
    list=extend_schema(operation_id="integracoes_tokens_listar"),
    create=extend_schema(
        operation_id="integracoes_tokens_criar",
        request=TokenIntegracaoSerializer,
        responses={201: TokenCriadoSerializer},
    ),
)
class TokenIntegracaoViewSet(
    mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet
):
    """Tokens de máquina das integrações (Administração › Integrações). O valor do token é
    mostrado uma única vez, na criação; depois só o prefixo."""

    permission_classes = [requer(P.ADMIN_CONFIGURACAO)]
    serializer_class = TokenIntegracaoSerializer
    pagination_class = None
    lookup_value_converter = "uuid"

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return TokenIntegracao.objects.none()
        return (
            TokenIntegracao.objects.select_related("criado_por")
            .prefetch_related("territorios")
            .annotate(total_lotes=Count("lotes", distinct=True))
        )

    def create(self, request, *args, **kwargs):
        dados = TokenIntegracaoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        token, valor = servico.criar_token(
            dados.validated_data["nome"], dados.validated_data["territorios"], request.user
        )
        token.token = valor
        token.total_lotes = 0
        return Response(TokenCriadoSerializer(token).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        operation_id="integracoes_tokens_revogar", request=None, responses=TokenIntegracaoSerializer
    )
    @action(detail=True, methods=["post"])
    def revogar(self, request, pk=None):
        """Revoga o token: a partir daqui, qualquer envio com ele é recusado (401)."""
        token = self.get_object()
        servico.revogar_token(token, request.user)
        return Response(TokenIntegracaoSerializer(self.get_queryset().get(pk=token.pk)).data)


__all__ = ["SituacaoSinal"]
