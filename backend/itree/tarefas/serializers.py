from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from itree.contas.models import Equipe, Usuario
from itree.contas.serializers import UsuarioResumoSerializer
from itree.inventario.models import Arvore, SituacaoArvore
from itree.inventario.serializers import CampoLocalizacao
from itree.ocorrencias.models import ESTADOS_FINAIS, Ocorrencia
from itree.ocorrencias.serializers import EquipeResumoSerializer

from .models import ESTADOS_FINAIS_TAREFA, TRANSICOES_TAREFA, EstadoTarefa, Tarefa, TipoTarefa


class TarefaSerializer(serializers.ModelSerializer):
    codigo = serializers.CharField(read_only=True)
    alvo = serializers.SerializerMethodField()
    localizacao = CampoLocalizacao(source="geom", read_only=True)
    arvore_id = serializers.PrimaryKeyRelatedField(
        source="arvore",
        queryset=Arvore.objects.filter(situacao=SituacaoArvore.ATIVA),
        write_only=True,
        required=False,
        allow_null=True,
    )
    ocorrencia_id = serializers.PrimaryKeyRelatedField(
        source="ocorrencia",
        queryset=Ocorrencia.objects.exclude(estado__in=ESTADOS_FINAIS),
        write_only=True,
        required=False,
        allow_null=True,
    )
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
    criada_por = UsuarioResumoSerializer(read_only=True)
    atrasada = serializers.SerializerMethodField()
    transicoes_possiveis = serializers.SerializerMethodField()
    motivo = serializers.CharField(
        write_only=True, required=False, allow_blank=True, max_length=500
    )

    class Meta:
        model = Tarefa
        fields = [
            "id",
            "codigo",
            "tipo",
            "alvo",
            "arvore_id",
            "ocorrencia_id",
            "localizacao",
            "descricao",
            "responsavel",
            "responsavel_id",
            "equipe",
            "equipe_id",
            "prazo",
            "prioridade",
            "estado",
            "motivo_estado",
            "transicoes_possiveis",
            "atrasada",
            "criada_por",
            "criado_em",
            "atualizado_em",
            "concluida_em",
            "motivo",
        ]
        read_only_fields = ["estado", "motivo_estado", "concluida_em"]

    @extend_schema_field(serializers.DictField())
    def get_alvo(self, obj):
        if obj.arvore_id:
            return {"tipo": "arvore", "id": str(obj.arvore_id), "codigo": obj.arvore.codigo}
        return {"tipo": "ocorrencia", "id": str(obj.ocorrencia_id), "codigo": obj.ocorrencia.codigo}

    def get_atrasada(self, obj) -> bool:
        return bool(
            obj.prazo
            and obj.estado not in ESTADOS_FINAIS_TAREFA
            and obj.prazo < timezone.localdate()
        )

    @extend_schema_field(
        serializers.ListField(child=serializers.ChoiceField(choices=EstadoTarefa.choices))
    )
    def get_transicoes_possiveis(self, obj):
        return sorted(TRANSICOES_TAREFA.get(obj.estado, set()))

    def validate(self, attrs):
        if self.instance is None:
            arvore, ocorrencia = attrs.get("arvore"), attrs.get("ocorrencia")
            tipo = attrs.get("tipo")
            if tipo == TipoTarefa.INSPECAO_ARVORE and not arvore:
                raise serializers.ValidationError({"arvore_id": "Informe a árvore a inspecionar."})
            if tipo == TipoTarefa.ATENDIMENTO_OCORRENCIA and not ocorrencia:
                raise serializers.ValidationError({"ocorrencia_id": "Informe a ocorrência."})
            alvo = arvore if tipo == TipoTarefa.INSPECAO_ARVORE else ocorrencia
            if alvo.geom is None:
                raise serializers.ValidationError("O alvo da tarefa não tem localização.")
            attrs["geom"] = alvo.geom
            if tipo == TipoTarefa.INSPECAO_ARVORE:
                attrs.pop("ocorrencia", None)
            else:
                attrs.pop("arvore", None)
        return attrs

    def create(self, validated_data):
        validated_data.pop("motivo", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("motivo", None)
        return super().update(instance, validated_data)


class TransicaoTarefaSerializer(serializers.Serializer):
    estado = serializers.ChoiceField(choices=EstadoTarefa.choices)
    motivo = serializers.CharField(required=False, allow_blank=True, max_length=500)


class TarefasEmLoteSerializer(serializers.Serializer):
    """Cria uma tarefa de inspeção por árvore (RF-EQP-003)."""

    arvore_ids = serializers.ListField(child=serializers.UUIDField(), required=False, default=list)
    filtros_arvores = serializers.DictField(
        child=serializers.CharField(),
        required=False,
        default=dict,
        help_text="Mesmos filtros da listagem de árvores; usado quando arvore_ids está vazio.",
    )
    responsavel_id = serializers.PrimaryKeyRelatedField(
        queryset=Usuario.objects.filter(is_active=True), required=False, allow_null=True
    )
    equipe_id = serializers.PrimaryKeyRelatedField(
        queryset=Equipe.objects.filter(ativa=True), required=False, allow_null=True
    )
    prazo = serializers.DateField(required=False, allow_null=True)
    prioridade = serializers.CharField(required=False, allow_blank=True)
    descricao = serializers.CharField(required=False, allow_blank=True)


class ResultadoLoteSerializer(serializers.Serializer):
    criadas = serializers.IntegerField()
    ignoradas = serializers.IntegerField(
        help_text="Árvores que já tinham tarefa de inspeção aberta."
    )
    fora_do_escopo_do_responsavel = serializers.IntegerField()
