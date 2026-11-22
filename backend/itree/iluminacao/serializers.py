"""Serializadores da iluminação pública: resumo da camada e postes próximos de uma árvore."""

from rest_framework import serializers


class PosteProximoSerializer(serializers.Serializer):
    codigo = serializers.CharField(help_text="Código do ponto de serviço na fonte (SEINF).")
    distancia_m = serializers.FloatField()
    tipo = serializers.CharField(allow_blank=True, help_text='Ex.: "CONCRETO DUPLO T".')
    altura_min_m = serializers.FloatField(allow_null=True)
    altura_max_m = serializers.FloatField(allow_null=True)
    logradouro = serializers.CharField(allow_blank=True)


class ResumoIluminacaoSerializer(serializers.Serializer):
    importada = serializers.BooleanField(help_text="Há pontos importados.")
    quantidade = serializers.IntegerField()
    fonte = serializers.CharField(allow_blank=True)
    fonte_url = serializers.CharField(allow_blank=True)
    licenca = serializers.CharField(allow_blank=True)
    data_referencia = serializers.DateField(allow_null=True)
    ingerido_em = serializers.DateTimeField(allow_null=True)
    raio_conflito_m = serializers.FloatField(
        help_text="Raio usado para listar árvores perto da iluminação. PROVISÓRIO."
    )
    raio_provisorio = serializers.BooleanField(
        help_text="Sempre verdadeiro enquanto a URBFOR e a SEINF não definirem o raio."
    )
    alturas_maximas_m = serializers.ListField(child=serializers.FloatField())
