import pghistory
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import (
    OpenApiParameter,
    extend_schema,
    extend_schema_view,
    inline_serializer,
)
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from itree.contas.acesso import filtrar_por_escopo
from itree.core import armazenamento
from itree.core.ids import uuid7
from itree.core.parametros import uuid_do_parametro
from itree.inventario.models import Arvore
from itree.ocorrencias.models import Ocorrencia

from .models import TAMANHO_MAXIMO, TIPOS_PERMITIDOS, EstadoEvidencia, Evidencia

PARAMETRO_ID = OpenApiParameter("id", OpenApiTypes.UUID, OpenApiParameter.PATH)


class ArmazenamentoIndisponivel(APIException):
    status_code = 503
    default_detail = "O armazenamento de arquivos não está configurado neste ambiente."


class EvidenciaSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField(help_text="URL temporária (5 min) para visualizar.")
    enviada_por_nome = serializers.SerializerMethodField()
    eh_imagem = serializers.BooleanField(read_only=True)

    class Meta:
        model = Evidencia
        fields = [
            "id",
            "nome_original",
            "tipo_conteudo",
            "tamanho",
            "descricao",
            "capturada_em",
            "estado",
            "eh_imagem",
            "url",
            "enviada_por_nome",
            "arvore",
            "ocorrencia",
            "criado_em",
        ]

    def get_url(self, obj) -> str | None:
        if obj.estado != EstadoEvidencia.DISPONIVEL or not armazenamento.s3_configurado():
            return None
        return armazenamento.url_download(obj.chave)

    def get_enviada_por_nome(self, obj) -> str:
        return obj.enviada_por.nome or obj.enviada_por.email


class NovaEvidenciaSerializer(serializers.Serializer):
    arvore = serializers.UUIDField(required=False, allow_null=True)
    ocorrencia = serializers.UUIDField(required=False, allow_null=True)
    nome_original = serializers.CharField(max_length=255)
    tipo_conteudo = serializers.ChoiceField(choices=sorted(TIPOS_PERMITIDOS))
    tamanho = serializers.IntegerField(min_value=1, max_value=TAMANHO_MAXIMO)
    descricao = serializers.CharField(max_length=500, required=False, allow_blank=True)
    capturada_em = serializers.DateTimeField(required=False, allow_null=True)

    def validate(self, attrs):
        if bool(attrs.get("arvore")) == bool(attrs.get("ocorrencia")):
            raise serializers.ValidationError(
                "Vincule a evidência a uma árvore ou a uma ocorrência."
            )
        return attrs


@extend_schema_view(
    list=extend_schema(
        operation_id="evidencias_listar",
        parameters=[OpenApiParameter("arvore", str), OpenApiParameter("ocorrencia", str)],
    ),
)
class EvidenciaViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Fotografias e documentos. Envio direto ao armazenamento privado por URL
    pré-assinada; a API só registra metadados e vínculo."""

    serializer_class = EvidenciaSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None
    lookup_value_converter = "uuid"

    def _alvo(self, arvore_id=None, ocorrencia_id=None, editar=False):
        usuario = self.request.user
        if arvore_id:
            permissao = "inventario.editar" if editar else "inventario.ler"
            qs = filtrar_por_escopo(Arvore.objects.all(), usuario, incluir_sem_geom=True)
            campo, valor = "arvore", arvore_id
        else:
            permissao = "ocorrencias.editar" if editar else "ocorrencias.ler"
            qs = filtrar_por_escopo(Ocorrencia.objects.all(), usuario)
            campo, valor = "ocorrencia", ocorrencia_id
        if not usuario.tem_permissao(permissao):
            raise PermissionDenied()
        objeto = qs.filter(pk=valor).first()
        if objeto is None:
            raise ValidationError({campo: "Registro não encontrado no seu escopo."})
        return campo, objeto

    def get_queryset(self):
        p = self.request.query_params
        arvore, ocorrencia = p.get("arvore"), p.get("ocorrencia")
        if not (arvore or ocorrencia):
            raise ValidationError("Informe 'arvore' ou 'ocorrencia'.")
        campo, objeto = self._alvo(
            arvore_id=arvore and uuid_do_parametro(arvore, "arvore"),
            ocorrencia_id=ocorrencia and uuid_do_parametro(ocorrencia, "ocorrencia"),
        )
        return Evidencia.objects.filter(
            **{campo: objeto}, estado=EstadoEvidencia.DISPONIVEL
        ).select_related("enviada_por")

    @extend_schema(
        operation_id="evidencias_iniciar_envio",
        request=NovaEvidenciaSerializer,
        responses={
            201: inline_serializer(
                "EnvioEvidencia",
                {
                    "evidencia": EvidenciaSerializer(),
                    "url_envio": serializers.CharField(),
                    "metodo": serializers.CharField(),
                    "cabecalhos": serializers.DictField(child=serializers.CharField()),
                },
            )
        },
    )
    def create(self, request):
        """Registra a evidência e devolve a URL para enviar o arquivo (PUT)."""
        if not armazenamento.s3_configurado():
            raise ArmazenamentoIndisponivel()
        dados = NovaEvidenciaSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        v = dados.validated_data
        campo, objeto = self._alvo(v.get("arvore"), v.get("ocorrencia"), editar=True)
        identificador = uuid7()
        hoje = timezone.now()
        chave = f"evidencias/{hoje:%Y/%m}/{identificador}.{TIPOS_PERMITIDOS[v['tipo_conteudo']]}"
        evidencia = Evidencia.objects.create(
            id=identificador,
            chave=chave,
            nome_original=v["nome_original"],
            tipo_conteudo=v["tipo_conteudo"],
            tamanho=v["tamanho"],
            descricao=v.get("descricao", ""),
            capturada_em=v.get("capturada_em"),
            enviada_por=request.user,
            **{campo: objeto},
        )
        return Response(
            {
                "evidencia": EvidenciaSerializer(evidencia).data,
                "url_envio": armazenamento.url_upload(chave, v["tipo_conteudo"]),
                "metodo": "PUT",
                "cabecalhos": {"Content-Type": v["tipo_conteudo"]},
            },
            status=status.HTTP_201_CREATED,
        )

    def _minha_evidencia(self, pk):
        evidencia = Evidencia.objects.filter(pk=uuid_do_parametro(pk, "id")).first()
        if evidencia is None:
            raise ValidationError("Evidência não encontrada.")
        self._alvo(evidencia.arvore_id, evidencia.ocorrencia_id, editar=True)
        return evidencia

    @extend_schema(
        operation_id="evidencias_confirmar_envio",
        parameters=[PARAMETRO_ID],
        request=None,
        responses=EvidenciaSerializer,
    )
    @action(detail=True, methods=["post"])
    def confirmar(self, request, pk=None):
        """Confere no armazenamento que o arquivo chegou com o tamanho declarado."""
        if not armazenamento.s3_configurado():
            raise ArmazenamentoIndisponivel()
        evidencia = self._minha_evidencia(pk)
        if evidencia.estado != EstadoEvidencia.AGUARDANDO_ENVIO:
            raise ValidationError("Esta evidência já foi confirmada.")
        meta = armazenamento.metadados(evidencia.chave)
        if meta is None:
            raise ValidationError("O arquivo ainda não chegou ao armazenamento.")
        if int(meta.get("ContentLength", -1)) != evidencia.tamanho:
            raise ValidationError("O arquivo recebido tem tamanho diferente do declarado.")
        evidencia.estado = EstadoEvidencia.DISPONIVEL
        evidencia.save(update_fields=["estado", "atualizado_em"])
        return Response(EvidenciaSerializer(evidencia).data)

    @extend_schema(
        operation_id="evidencias_remover",
        parameters=[PARAMETRO_ID],
        request=inline_serializer("RemoverEvidencia", {"motivo": serializers.CharField()}),
        responses=EvidenciaSerializer,
    )
    @action(detail=True, methods=["post"])
    def remover(self, request, pk=None):
        """Oculta a evidência. O arquivo é preservado para rastreabilidade."""
        evidencia = self._minha_evidencia(pk)
        motivo = (request.data.get("motivo") or "").strip()
        if not motivo:
            raise ValidationError({"motivo": "Informe a justificativa."})
        with pghistory.context(motivo=motivo):
            evidencia.estado = EstadoEvidencia.REMOVIDA
            evidencia.save(update_fields=["estado", "atualizado_em"])
        return Response(EvidenciaSerializer(evidencia).data)
