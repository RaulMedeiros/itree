"""Qualidade de dados (T-04, P0) e sugestões de IA.

A qualidade usa **regras explícitas**: cada pendência diz o critério que a
gerou e leva à lista filtrada. Nada é corrigido automaticamente."""

from datetime import timedelta

import pghistory
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from itree.contas.acesso import filtrar_por_escopo, requer
from itree.contas.permissoes import Permissao
from itree.core.parametros import uuid_do_parametro
from itree.inspecoes.models import EstadoInspecao, Inspecao
from itree.inventario.duplicidades import pares_suspeitos
from itree.inventario.models import (
    Arvore,
    Especie,
    EstadoEspecie,
    Medida,
    SituacaoArvore,
    TipoMedida,
)
from itree.ocorrencias.models import ESTADOS_FINAIS, Ocorrencia

from .models import DecisaoIA, InferenciaIA, TarefaIA

P = Permissao

# Limites de plausibilidade (provisórios; revisar com o protocolo técnico, DP-03).
LIMITES = {TipoMedida.ALTURA: (0.5, 60), TipoMedida.DAP: (1, 400), TipoMedida.CAP: (3, 1250)}


@extend_schema(
    operation_id="qualidade_pendencias",
    responses=inline_serializer(
        "PendenciasQualidade",
        {
            "calculado_em": serializers.DateTimeField(),
            "pendencias": serializers.ListField(child=serializers.DictField()),
        },
    ),
)
@api_view(["GET"])
def pendencias(request: Request):
    usuario = request.user
    if not usuario.tem_permissao("inventario.ler"):
        raise PermissionDenied()
    agora = timezone.now()
    arvores = filtrar_por_escopo(
        Arvore.objects.filter(situacao=SituacaoArvore.ATIVA), usuario, incluir_sem_geom=True
    )
    implausiveis = Q()
    for tipo, (minimo, maximo) in LIMITES.items():
        implausiveis |= Q(tipo=tipo) & (Q(valor__lt=minimo) | Q(valor__gt=maximo))
    medidas = Medida.objects.filter(implausiveis, aplicada=True, arvore__in=arvores)
    itens = [
        {
            "id": "sem_localizacao",
            "titulo": "Árvores sem localização",
            "criterio": "Registro ativo sem coordenadas: não aparece no mapa nem conta como válido.",
            "quantidade": arvores.filter(geom__isnull=True).count(),
            "gravidade": "alta",
            "link": None,
        },
        {
            "id": "especie_fora_catalogo",
            "titulo": "Espécie informada fora do catálogo",
            "criterio": "Nome importado que não corresponde a nenhuma espécie do catálogo.",
            "quantidade": arvores.filter(especie__isnull=True)
            .exclude(especie_texto_original="")
            .count(),
            "gravidade": "media",
            "link": {"pagina": "/inventario/arvores", "filtros": {"especie_estado": "informada"}},
        },
        {
            "id": "especie_nao_identificada",
            "titulo": "Espécie não identificada",
            "criterio": "Sem espécie informada nem confirmada.",
            "quantidade": arvores.filter(especie_estado=EstadoEspecie.NAO_IDENTIFICADA).count(),
            "gravidade": "media",
            "link": {
                "pagina": "/inventario/arvores",
                "filtros": {"especie_estado": "nao_identificada"},
            },
        },
        {
            "id": "importada_sem_precisao",
            "titulo": "Localização importada sem precisão",
            "criterio": "Coordenada importada sem precisão informada pela fonte.",
            "quantidade": arvores.filter(
                localizacao_origem="importada", precisao_m__isnull=True
            ).count(),
            "gravidade": "baixa",
            "link": {
                "pagina": "/inventario/arvores",
                "filtros": {"localizacao_origem": "importada"},
            },
        },
        {
            "id": "fora_de_bairro",
            "titulo": "Árvores fora dos bairros cadastrados",
            "criterio": "Coordenada que não cai em nenhum bairro: pode indicar erro de coordenada ou de SRC.",
            "quantidade": arvores.filter(geom__isnull=False, bairro__isnull=True).count(),
            "gravidade": "media",
            "link": None,
        },
        {
            "id": "medidas_implausiveis",
            "titulo": "Medidas fora da faixa plausível",
            "criterio": "Altura fora de 0,5–60 m, DAP fora de 1–400 cm ou CAP fora de 3–1250 cm (faixas provisórias).",
            "quantidade": medidas.values("arvore_id").distinct().count(),
            "gravidade": "alta",
            "link": None,
            "exemplos": [
                {
                    "arvore": m.arvore.codigo,
                    "arvore_id": str(m.arvore_id),
                    "tipo": m.tipo,
                    "valor": float(m.valor),
                    "unidade": m.unidade,
                }
                for m in medidas.select_related("arvore")[:10]
            ],
        },
        {
            "id": "possiveis_duplicidades",
            "titulo": "Possíveis duplicidades",
            "criterio": "Árvores a até 3 m com espécies compatíveis, ainda não revisadas.",
            "quantidade": len(pares_suspeitos(filtrar_por_escopo(Arvore.objects.all(), usuario))),
            "gravidade": "media",
            "link": {"pagina": "/inventario/duplicidades", "filtros": {}},
        },
    ]
    if usuario.tem_permissao("inspecoes.ler"):
        inspecoes = filtrar_por_escopo(Inspecao.objects.all(), usuario, campo_geom="arvore__geom")
        itens.append(
            {
                "id": "revisao_atrasada",
                "titulo": "Inspeções aguardando revisão há mais de 7 dias",
                "criterio": "Enviadas pelo campo e ainda não validadas nem devolvidas.",
                "quantidade": inspecoes.filter(
                    estado=EstadoInspecao.EM_REVISAO, recebida_em__lt=agora - timedelta(days=7)
                ).count(),
                "gravidade": "media",
                "link": {"pagina": "/inspecoes", "filtros": {"estado": "em_revisao"}},
            }
        )
    if usuario.tem_permissao("ocorrencias.ler"):
        ocorrencias = filtrar_por_escopo(
            Ocorrencia.objects.exclude(estado__in=ESTADOS_FINAIS), usuario
        )
        itens.append(
            {
                "id": "ocorrencia_sem_prioridade",
                "titulo": "Ocorrências sem prioridade há mais de 3 dias",
                "criterio": "Em aberto, sem prioridade operacional definida pela gestão.",
                "quantidade": ocorrencias.filter(
                    prioridade="", criado_em__lt=agora - timedelta(days=3)
                ).count(),
                "gravidade": "media",
                "link": {"pagina": "/ocorrencias", "filtros": {"prioridade": "sem"}},
            }
        )
    return Response({"calculado_em": agora, "pendencias": itens})


# --- Sugestões de IA ------------------------------------------------------------


class InferenciaSerializer(serializers.ModelSerializer):
    arvore_codigo = serializers.CharField(source="arvore.codigo", read_only=True)
    decidida_por_nome = serializers.SerializerMethodField()
    especie_escolhida_nome = serializers.CharField(
        source="especie_escolhida.nome_cientifico", read_only=True, default=None, allow_null=True
    )

    class Meta:
        model = InferenciaIA
        fields = [
            "id",
            "tarefa",
            "arvore",
            "arvore_codigo",
            "inspecao",
            "modelo",
            "versao_modelo",
            "resultado",
            "alternativas",
            "qualidade_insuficiente",
            "orientacao",
            "decisao",
            "especie_escolhida",
            "especie_escolhida_nome",
            "decidida_por_nome",
            "decidida_em",
            "criado_em",
        ]
        read_only_fields = ["decisao", "especie_escolhida", "decidida_em"]

    def get_decidida_por_nome(self, obj) -> str | None:
        return (obj.decidida_por.nome or obj.decidida_por.email) if obj.decidida_por else None


class NovaInferenciaSerializer(serializers.Serializer):
    """Registrada pelo serviço de inferência (conta de serviço com permissão)."""

    tarefa = serializers.ChoiceField(choices=TarefaIA.choices)
    arvore = serializers.PrimaryKeyRelatedField(queryset=Arvore.objects.all())
    inspecao = serializers.PrimaryKeyRelatedField(
        queryset=Inspecao.objects.all(), required=False, allow_null=True
    )
    modelo = serializers.CharField(max_length=100)
    versao_modelo = serializers.CharField(max_length=50)
    resultado = serializers.JSONField()
    especies_sugeridas = serializers.PrimaryKeyRelatedField(
        queryset=Especie.objects.all(), many=True, required=False, default=list
    )
    qualidade_insuficiente = serializers.BooleanField(default=False)
    orientacao = serializers.CharField(required=False, allow_blank=True)

    def validate_resultado(self, valor):
        # Percentuais sem calibração validada não são exibidos (RN-IA-003, DP-13).
        texto = str(valor).lower()
        if any(
            chave in texto for chave in ("confianca", "confidence", "probabilidade", "probability")
        ):
            raise serializers.ValidationError(
                "Envie o resultado sem percentuais de confiança: a calibração ainda não foi validada (DP-13)."
            )
        return valor


class DecisaoSerializer(serializers.Serializer):
    decisao = serializers.ChoiceField(choices=[DecisaoIA.ACEITA, DecisaoIA.REJEITADA])
    especie = serializers.PrimaryKeyRelatedField(
        queryset=Especie.objects.filter(ativa=True), required=False, allow_null=True
    )
    motivo = serializers.CharField(required=False, allow_blank=True, max_length=500)


class InferenciaViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Sugestões de IA. Não alteram o cadastro sem decisão explícita (RN-INV-003)."""

    serializer_class = InferenciaSerializer
    lookup_value_converter = "uuid"
    pagination_class = None

    def get_permissions(self):
        if self.action == "create":
            return [requer(P.ADMIN_CONFIGURACAO)()]
        if self.action == "decidir":
            return [requer(P.INSPECOES_VALIDAR)()]
        return [requer(P.INVENTARIO_LER)()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return InferenciaIA.objects.none()
        qs = filtrar_por_escopo(
            InferenciaIA.objects.select_related("arvore", "decidida_por", "especie_escolhida"),
            self.request.user,
            campo_geom="arvore__geom",
        )
        if arvore := self.request.query_params.get("arvore"):
            qs = qs.filter(arvore_id=uuid_do_parametro(arvore, "arvore"))
        if decisao := self.request.query_params.get("decisao"):
            qs = qs.filter(decisao=decisao)
        return qs

    @extend_schema(
        operation_id="inferencias_listar",
        parameters=[OpenApiParameter("arvore", str), OpenApiParameter("decisao", str)],
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(
        operation_id="inferencias_registrar",
        request=NovaInferenciaSerializer,
        responses={201: InferenciaSerializer},
    )
    def create(self, request, *args, **kwargs):
        dados = NovaInferenciaSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        v = dados.validated_data
        inferencia = InferenciaIA.objects.create(
            tarefa=v["tarefa"],
            arvore=v["arvore"],
            inspecao=v.get("inspecao"),
            modelo=v["modelo"],
            versao_modelo=v["versao_modelo"],
            resultado=v["resultado"],
            alternativas=[
                {"especie_id": str(e.id), "nome": e.nome_cientifico}
                for e in v["especies_sugeridas"]
            ],
            qualidade_insuficiente=v["qualidade_insuficiente"],
            orientacao=v.get("orientacao", ""),
            registrada_por=request.user,
        )
        return Response(InferenciaSerializer(inferencia).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        operation_id="inferencias_decidir",
        request=DecisaoSerializer,
        responses=InferenciaSerializer,
    )
    @action(detail=True, methods=["post"])
    def decidir(self, request, pk=None):
        """Aceitar confirma a espécie escolhida pelo revisor; rejeitar só registra.
        O resultado original do modelo é sempre preservado (CA-INV-005)."""
        inferencia = self.get_object()
        if inferencia.decisao != DecisaoIA.PENDENTE:
            raise ValidationError("Esta sugestão já foi decidida.")
        dados = DecisaoSerializer(data=request.data)
        dados.is_valid(raise_exception=True)
        v = dados.validated_data
        with (
            transaction.atomic(),
            pghistory.context(
                motivo=v.get("motivo") or None,
                evento="decisao_ia",
                modelo=f"{inferencia.modelo} {inferencia.versao_modelo}",
            ),
        ):
            if v["decisao"] == DecisaoIA.ACEITA:
                if inferencia.tarefa != TarefaIA.ESPECIE or not v.get("especie"):
                    raise ValidationError({"especie": ["Escolha a espécie a confirmar."]})
                arvore = inferencia.arvore
                arvore.especie = v["especie"]
                arvore.especie_estado = EstadoEspecie.CONFIRMADA
                arvore.save(update_fields=["especie", "especie_estado", "atualizado_em"])
                inferencia.especie_escolhida = v["especie"]
            inferencia.decisao = v["decisao"]
            inferencia.decidida_por = request.user
            inferencia.decidida_em = timezone.now()
            inferencia.save()
        return Response(InferenciaSerializer(inferencia).data)
