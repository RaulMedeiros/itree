from rest_framework import serializers

from .models import Territorio


class TerritorioResumoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Territorio
        fields = ["id", "nome", "tipo"]


class TerritorioSerializer(serializers.ModelSerializer):
    """Território com proveniência; sem geometria (ver endpoint GeoJSON)."""

    pai = TerritorioResumoSerializer(read_only=True)
    arvores_no_escopo = serializers.IntegerField(
        read_only=True,
        default=None,
        help_text="Árvores ativas do território no escopo de quem consulta (só na listagem).",
    )

    class Meta:
        model = Territorio
        fields = [
            "id",
            "nome",
            "tipo",
            "codigo",
            "pai",
            "fonte",
            "fonte_url",
            "licenca",
            "data_referencia",
            "ingerido_em",
            "arvores_no_escopo",
        ]
