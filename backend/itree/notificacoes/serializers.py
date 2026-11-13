from django.utils import timezone
from rest_framework import serializers

from .models import Notificacao, TipoNotificacao


class NotificacaoSerializer(serializers.ModelSerializer):
    lida = serializers.SerializerMethodField()

    class Meta:
        model = Notificacao
        fields = ["id", "tipo", "titulo", "texto", "link", "lida", "lida_em", "criado_em"]
        read_only_fields = fields

    def get_lida(self, obj) -> bool:
        return obj.lida_em is not None


class ContagemNaoLidasSerializer(serializers.Serializer):
    nao_lidas = serializers.IntegerField()


class GrupoNotificacoesSerializer(serializers.Serializer):
    """Notificações do mesmo tipo no mesmo dia, para o menu do sino."""

    tipo = serializers.ChoiceField(choices=TipoNotificacao.choices)
    dia = serializers.DateField(help_text="Dia no fuso de Fortaleza.")
    quantidade = serializers.IntegerField()
    nao_lidas = serializers.IntegerField()
    lida = serializers.BooleanField(help_text="Verdadeiro quando não resta nenhuma não lida.")
    titulo = serializers.CharField(
        help_text='Com mais de uma: "5 inspeções aguardando revisão"; com uma, o título dela.'
    )
    texto = serializers.CharField(allow_blank=True)
    link = serializers.CharField(allow_blank=True)
    ultima_em = serializers.DateTimeField()


class LerGrupoSerializer(serializers.Serializer):
    tipo = serializers.ChoiceField(choices=TipoNotificacao.choices)
    dia = serializers.DateField()


class PreferenciaNotificacaoSerializer(serializers.Serializer):
    tipo = serializers.ChoiceField(choices=TipoNotificacao.choices)
    rotulo = serializers.CharField(read_only=True)
    ativa = serializers.BooleanField(help_text="Recebe este tipo no sino.")
    email = serializers.BooleanField(
        help_text="Recebe também por e-mail. Só vale com a notificação ativa."
    )


class AtualizarPreferenciasSerializer(serializers.Serializer):
    preferencias = PreferenciaNotificacaoSerializer(many=True)

    def validate_preferencias(self, valor):
        tipos = [p["tipo"] for p in valor]
        if len(tipos) != len(set(tipos)):
            raise serializers.ValidationError("Cada tipo pode aparecer uma só vez.")
        return valor


class TerritorioEscolhidoSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    nome = serializers.CharField()


class AjustesNotificacaoSerializer(serializers.Serializer):
    """Bairros de interesse e silêncio temporário (M-27)."""

    territorios = TerritorioEscolhidoSerializer(
        many=True,
        read_only=True,
        help_text="Bairros dos quais a pessoa quer receber. Vazio = todo o seu escopo.",
    )
    silenciada_ate = serializers.DateField(
        read_only=True,
        allow_null=True,
        help_text="Até esta data (inclusive) nenhuma notificação nova é criada. "
        "Vazio ou no passado = recebe normalmente.",
    )
    silenciada = serializers.BooleanField(
        read_only=True, help_text="Hoje a pessoa está em silêncio."
    )


class AtualizarAjustesSerializer(serializers.Serializer):
    """Só o que vem no corpo muda: ``territorios_ids`` vazio volta a receber de todo o escopo
    e ``silenciada_ate`` nulo encerra o silêncio."""

    territorios_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        max_length=200,
        help_text="Bairros, todos dentro do escopo territorial de quem pede.",
    )
    silenciada_ate = serializers.DateField(
        required=False, allow_null=True, help_text="Hoje ou depois (AAAA-MM-DD)."
    )

    def validate_silenciada_ate(self, valor):
        if valor is not None and valor < timezone.localdate():
            raise serializers.ValidationError("Escolha hoje ou uma data futura.")
        return valor
