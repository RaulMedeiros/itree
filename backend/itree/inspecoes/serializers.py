from decimal import Decimal

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from itree.contas.serializers import UsuarioResumoSerializer
from itree.inventario.models import Arvore, Especie, MetodoMedida, OrigemValor, TipoMedida
from itree.inventario.serializers import (
    CampoLocalizacao,
    EspecieResumoSerializer,
    MedidaSerializer,
)
from itree.tarefas.models import Tarefa

from .models import CondicaoAparente, Inspecao, SinalObservado
from .servicos import APLICAVEIS


class ArvoreDaInspecaoSerializer(serializers.ModelSerializer):
    codigo = serializers.CharField(read_only=True)
    especie = EspecieResumoSerializer(read_only=True, allow_null=True)
    localizacao = CampoLocalizacao(source="geom", read_only=True)
    bairro = serializers.CharField(
        source="bairro.nome", read_only=True, allow_null=True, default=None
    )

    class Meta:
        model = Arvore
        fields = [
            "id",
            "codigo",
            "especie",
            "especie_estado",
            "localizacao",
            "localizacao_origem",
            "precisao_m",
            "endereco",
            "bairro",
            "condicao_aparente",
            "condicao_aparente_em",
        ]


class InspecaoResumoSerializer(serializers.ModelSerializer):
    codigo = serializers.CharField(read_only=True)
    arvore = ArvoreDaInspecaoSerializer(read_only=True)
    tecnico = UsuarioResumoSerializer(read_only=True)
    revisor = UsuarioResumoSerializer(read_only=True, allow_null=True)
    especie = EspecieResumoSerializer(read_only=True, allow_null=True)

    class Meta:
        model = Inspecao
        fields = [
            "id",
            "codigo",
            "arvore",
            "tecnico",
            "realizada_em",
            "recebida_em",
            "estado",
            "condicao_aparente",
            "sinais",
            "especie",
            "especie_texto",
            "requer_encaminhamento",
            "origem",
            "revisor",
            "validada_em",
            "versao",
        ]


class InspecaoSerializer(InspecaoResumoSerializer):
    localizacao = CampoLocalizacao(source="geom", read_only=True)
    medidas = MedidaSerializer(many=True, read_only=True)
    anterior = serializers.SerializerMethodField(
        help_text="Inspeção anterior da mesma árvore, para comparação (RF-INSP-004)."
    )
    tarefa = serializers.SerializerMethodField()

    class Meta(InspecaoResumoSerializer.Meta):
        fields = [
            *InspecaoResumoSerializer.Meta.fields,
            "localizacao",
            "precisao_m",
            "arvore_confirmada",
            "observacoes",
            "motivo_devolucao",
            "aplicado_ao_cadastro",
            "dispositivo",
            "medidas",
            "anterior",
            "tarefa",
        ]

    @extend_schema_field(InspecaoResumoSerializer(allow_null=True))
    def get_anterior(self, obj):
        anterior = (
            Inspecao.objects.filter(arvore_id=obj.arvore_id, realizada_em__lt=obj.realizada_em)
            .exclude(pk=obj.pk)
            .select_related("arvore", "tecnico", "revisor", "especie")
            .order_by("-realizada_em")
            .first()
        )
        return InspecaoResumoSerializer(anterior).data if anterior else None

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_tarefa(self, obj):
        return {"id": str(obj.tarefa_id), "codigo": obj.tarefa.codigo} if obj.tarefa_id else None


class MedidaDeCampoSerializer(serializers.Serializer):
    tipo = serializers.ChoiceField(choices=TipoMedida.choices)
    valor = serializers.DecimalField(max_digits=8, decimal_places=2, min_value=Decimal("0.01"))
    metodo = serializers.ChoiceField(choices=MetodoMedida.choices)
    origem = serializers.ChoiceField(choices=[OrigemValor.MEDIDO, OrigemValor.ESTIMADO])
    data_medicao = serializers.DateField(required=False, allow_null=True)
    observacao = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs["origem"] == OrigemValor.MEDIDO and attrs["metodo"] in (
            MetodoMedida.VISUAL,
            MetodoMedida.IMAGEM,
        ):
            raise serializers.ValidationError("Estimativas visuais ou por imagem não são medidas.")
        return attrs


class InspecaoDeCampoSerializer(serializers.Serializer):
    """Inspeção enviada pelo aplicativo (pode ter sido criada offline)."""

    id = serializers.UUIDField(help_text="Gerado no dispositivo (UUIDv7).")
    versao_base = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="Versão que o dispositivo recebeu por último; vazio na primeira transmissão.",
    )
    arvore = serializers.PrimaryKeyRelatedField(queryset=Arvore.objects.all())
    tarefa = serializers.PrimaryKeyRelatedField(
        queryset=Tarefa.objects.all(), required=False, allow_null=True
    )
    realizada_em = serializers.DateTimeField()
    localizacao = CampoLocalizacao(source="geom", required=False, allow_null=True)
    precisao_m = serializers.FloatField(required=False, allow_null=True, min_value=0)
    arvore_confirmada = serializers.BooleanField(default=True)
    especie = serializers.PrimaryKeyRelatedField(
        queryset=Especie.objects.filter(ativa=True), required=False, allow_null=True
    )
    especie_texto = serializers.CharField(required=False, allow_blank=True, max_length=200)
    condicao_aparente = serializers.ChoiceField(
        choices=CondicaoAparente.choices, default="nao_avaliada"
    )
    sinais = serializers.ListField(
        child=serializers.ChoiceField(choices=SinalObservado.choices), required=False, default=list
    )
    observacoes = serializers.CharField(required=False, allow_blank=True)
    requer_encaminhamento = serializers.BooleanField(default=False)
    medidas = MedidaDeCampoSerializer(many=True, required=False, default=list)
    enviar_para_revisao = serializers.BooleanField(default=False)


class LoteSincronizacaoSerializer(serializers.Serializer):
    dispositivo = serializers.CharField(max_length=100)
    inspecoes = serializers.ListField(child=serializers.DictField(), max_length=200)


class ResultadoSincronizacaoSerializer(serializers.Serializer):
    id = serializers.CharField()
    status = serializers.ChoiceField(
        choices=["criada", "atualizada", "ja_recebida", "conflito", "erro"]
    )
    versao = serializers.IntegerField(allow_null=True)
    estado = serializers.CharField(allow_null=True)
    mensagem = serializers.CharField()
    erros = serializers.DictField()


class ValidacaoSerializer(serializers.Serializer):
    aplicar = serializers.ListField(
        child=serializers.ChoiceField(choices=APLICAVEIS),
        default=list,
        help_text="Valores da inspeção que atualizam o cadastro da árvore.",
    )
    motivo = serializers.CharField(required=False, allow_blank=True, max_length=500)


class DevolucaoSerializer(serializers.Serializer):
    motivo = serializers.CharField(max_length=2000)
