from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from itree.contas.models import Equipe, Usuario
from itree.contas.serializers import UsuarioResumoSerializer
from itree.core.lote import IdsEmLoteSerializer
from itree.evidencias.models import EstadoEvidencia
from itree.inventario.models import Arvore, SituacaoArvore
from itree.inventario.serializers import CampoLocalizacao
from itree.ocorrencias.models import ESTADOS_FINAIS, Ocorrencia
from itree.ocorrencias.serializers import EquipeResumoSerializer, RegistroVinculadoSerializer

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
    origem = serializers.SerializerMethodField(
        help_text="De onde a tarefa veio: a inspeção que originou a ocorrência atendida."
    )
    transicoes_possiveis = serializers.SerializerMethodField()
    exige_evidencia = serializers.BooleanField(
        read_only=True,
        help_text="Tarefa de execução em campo: só conclui com evidência fotográfica anexada.",
    )
    total_evidencias = serializers.SerializerMethodField(
        help_text="Evidências disponíveis anexadas à tarefa."
    )
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
            "origem",
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
            "resultado",
            "exige_evidencia",
            "total_evidencias",
            "transicoes_possiveis",
            "atrasada",
            "criada_por",
            "criado_em",
            "atualizado_em",
            "concluida_em",
            "motivo",
        ]
        read_only_fields = ["estado", "motivo_estado", "resultado", "concluida_em"]

    @extend_schema_field(serializers.DictField())
    def get_alvo(self, obj):
        if obj.arvore_id:
            return {"tipo": "arvore", "id": str(obj.arvore_id), "codigo": obj.arvore.codigo}
        return {"tipo": "ocorrencia", "id": str(obj.ocorrencia_id), "codigo": obj.ocorrencia.codigo}

    @extend_schema_field(RegistroVinculadoSerializer(allow_null=True))
    def get_origem(self, obj):
        ocorrencia = obj.ocorrencia
        if ocorrencia is not None and ocorrencia.inspecao_id:
            return {
                "tipo": "inspecao",
                "id": ocorrencia.inspecao_id,
                "codigo": ocorrencia.inspecao.codigo,
            }
        return None

    def get_total_evidencias(self, obj) -> int:
        # A listagem e o detalhe trazem a contagem anotada; nos demais casos, conta aqui.
        total = getattr(obj, "total_evidencias", None)
        if total is None:
            total = obj.evidencias.filter(estado=EstadoEvidencia.DISPONIVEL).count()
        return total

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
        if self.instance is not None:
            # Trocar o alvo mudaria a área da tarefa sem passar pela checagem de
            # escopo da criação; outra tarefa deve ser criada.
            if {"tipo", "arvore", "ocorrencia"} & attrs.keys():
                raise serializers.ValidationError(
                    "O tipo e o alvo da tarefa não podem ser alterados; crie outra tarefa."
                )
            return attrs
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
    resultado = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=2000,
        help_text="O que foi feito. Obrigatório ao concluir.",
    )


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


class EquipeEmLoteSerializer(IdsEmLoteSerializer):
    equipe_id = serializers.PrimaryKeyRelatedField(
        queryset=Equipe.objects.filter(ativa=True),
        help_text="Equipe que passa a atender as tarefas marcadas.",
    )
