from rest_framework import serializers

from .models import Notificacao


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
