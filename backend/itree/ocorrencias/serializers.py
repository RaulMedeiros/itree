from datetime import timedelta

from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from itree.contas.models import Equipe, Usuario
from itree.contas.serializers import UsuarioResumoSerializer
from itree.inventario.models import Arvore, SituacaoArvore
from itree.inventario.serializers import CampoLocalizacao
from itree.territorio.serializers import TerritorioResumoSerializer

from .models import ESTADOS_FINAIS, EstadoOcorrencia, Ocorrencia, Prioridade, TipoOcorrencia


class TipoOcorrenciaSerializer(serializers.ModelSerializer):
    class Meta:
        model = TipoOcorrencia
        fields = ["id", "nome", "descricao", "prazo_padrao_dias", "ativo"]


class EquipeResumoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Equipe
        fields = ["id", "nome"]


class OcorrenciaSerializer(serializers.ModelSerializer):
    codigo = serializers.CharField(read_only=True)
    tipo = TipoOcorrenciaSerializer(read_only=True)
    tipo_id = serializers.PrimaryKeyRelatedField(
        source="tipo", queryset=TipoOcorrencia.objects.filter(ativo=True), write_only=True
    )
    arvore = serializers.SerializerMethodField()
    arvore_id = serializers.PrimaryKeyRelatedField(
        source="arvore",
        queryset=Arvore.objects.filter(situacao=SituacaoArvore.ATIVA),
        write_only=True,
        required=False,
        allow_null=True,
    )
    localizacao = CampoLocalizacao(source="geom", required=False, allow_null=True)
    bairro = TerritorioResumoSerializer(read_only=True)
    responsavel = UsuarioResumoSerializer(read_only=True, allow_null=True)
    responsavel_id = serializers.PrimaryKeyRelatedField(
        source="responsavel",
        queryset=Usuario.objects.filter(is_active=True),
        write_only=True,
        required=False,
        allow_null=True,
    )
    equipe = EquipeResumoSerializer(read_only=True, allow_null=True)
    equipe_id = serializers.PrimaryKeyRelatedField(
        source="equipe",
        queryset=Equipe.objects.filter(ativa=True),
        write_only=True,
        required=False,
        allow_null=True,
    )
    prioridade = serializers.ChoiceField(
        choices=Prioridade.choices,
        allow_blank=True,
        read_only=True,
        help_text="Vazio enquanto a gestão não definir a prioridade.",
    )
    prioridade_definida_por = UsuarioResumoSerializer(read_only=True, allow_null=True)
    risco_responsavel = UsuarioResumoSerializer(read_only=True, allow_null=True)
    registrada_por = UsuarioResumoSerializer(read_only=True)
    atrasada = serializers.SerializerMethodField()
    transicoes_possiveis = serializers.SerializerMethodField()

    class Meta:
        model = Ocorrencia
        fields = [
            "id",
            "codigo",
            "tipo",
            "tipo_id",
            "arvore",
            "arvore_id",
            "localizacao",
            "bairro",
            "endereco",
            "descricao",
            "condicao_aparente",
            "prioridade",
            "prioridade_definida_por",
            "prioridade_definida_em",
            "risco_confirmado",
            "risco_descricao",
            "risco_responsavel",
            "risco_registrado_em",
            "estado",
            "transicoes_possiveis",
            "responsavel",
            "responsavel_id",
            "equipe",
            "equipe_id",
            "prazo",
            "atrasada",
            "origem",
            "origem_referencia",
            "registrada_por",
            "criado_em",
            "atualizado_em",
            "concluida_em",
        ]
        read_only_fields = [
            "prioridade",
            "prioridade_definida_em",
            "risco_confirmado",
            "risco_descricao",
            "risco_registrado_em",
            "estado",
            "origem",
            "origem_referencia",
            "concluida_em",
        ]

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_arvore(self, obj):
        if not obj.arvore_id:
            return None
        return {"id": str(obj.arvore_id), "codigo": obj.arvore.codigo}

    def get_atrasada(self, obj) -> bool:
        return bool(
            obj.prazo and obj.estado not in ESTADOS_FINAIS and obj.prazo < timezone.localdate()
        )

    @extend_schema_field(
        serializers.ListField(child=serializers.ChoiceField(choices=EstadoOcorrencia.choices))
    )
    def get_transicoes_possiveis(self, obj):
        from .models import TRANSICOES

        possiveis = sorted(TRANSICOES.get(obj.estado, set()))
        if obj.estado not in ESTADOS_FINAIS:
            possiveis.append(EstadoOcorrencia.CANCELADA)
        return possiveis

    def validate(self, attrs):
        if self.instance is None:
            arvore = attrs.get("arvore")
            if attrs.get("geom") is None:
                if arvore is None or arvore.geom is None:
                    raise serializers.ValidationError(
                        {"localizacao": "Informe a localização ou uma árvore com localização."}
                    )
                attrs["geom"] = arvore.geom
            if not attrs.get("prazo") and attrs["tipo"].prazo_padrao_dias:
                attrs["prazo"] = timezone.localdate() + timedelta(
                    days=attrs["tipo"].prazo_padrao_dias
                )
        return attrs


class TransicaoSerializer(serializers.Serializer):
    estado = serializers.ChoiceField(choices=EstadoOcorrencia.choices)
    motivo = serializers.CharField(max_length=500, required=False, allow_blank=True)


class PrioridadeSerializer(serializers.Serializer):
    prioridade = serializers.ChoiceField(choices=Prioridade.choices)
    motivo = serializers.CharField(max_length=500, required=False, allow_blank=True)


class RiscoSerializer(serializers.Serializer):
    descricao = serializers.CharField(max_length=2000)
