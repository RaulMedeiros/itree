from rest_framework import serializers

from .models import AreaVerde


class AreaVerdeResumoSerializer(serializers.ModelSerializer):
    """Identificação mínima, para a ficha e o painel da árvore."""

    class Meta:
        model = AreaVerde
        fields = ["id", "nome", "tipo"]
