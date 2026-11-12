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
