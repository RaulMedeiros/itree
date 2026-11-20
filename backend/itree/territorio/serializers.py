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


# --- Ficha do bairro (só descrevem a resposta no contrato OpenAPI) -----------------------


class FichaReferenciaSerializer(serializers.Serializer):
    valor = serializers.FloatField()
    rotulo = serializers.CharField(help_text='Ex.: "Média de Fortaleza".')


class FichaExtraSerializer(serializers.Serializer):
    rotulo = serializers.CharField()
    valor = serializers.CharField()


class FichaLinkSerializer(serializers.Serializer):
    pagina = serializers.CharField()
    filtros = serializers.DictField(child=serializers.CharField())


class FichaCartaoSerializer(serializers.Serializer):
    id = serializers.CharField()
    titulo = serializers.CharField()
    valor = serializers.FloatField(allow_null=True, help_text="Nulo quando ``sem_dado``.")
    unidade = serializers.CharField(help_text='"%", "°C" ou vazio (contagem).')
    detalhe = serializers.CharField()
    nota = serializers.CharField(help_text="Ressalva, ou o motivo de não haver dado.")
    sem_dado = serializers.BooleanField()
    provisorio = serializers.BooleanField()
    base = serializers.IntegerField(allow_null=True)
    cidade = FichaReferenciaSerializer(allow_null=True)
    extras = FichaExtraSerializer(many=True)
    fonte = serializers.CharField()
    fonte_url = serializers.CharField()
    licenca = serializers.CharField()
    data_referencia = serializers.DateField(allow_null=True)
    definicao = serializers.CharField()
    metodo = serializers.CharField()
    link = FichaLinkSerializer(allow_null=True)


class FichaItemGraficoSerializer(serializers.Serializer):
    id = serializers.CharField()
    rotulo = serializers.CharField()
    valor = serializers.IntegerField()


class FichaGraficoSerializer(serializers.Serializer):
    titulo = serializers.CharField()
    definicao = serializers.CharField()
    itens = FichaItemGraficoSerializer(many=True)
    fonte = serializers.CharField()
    total_confirmadas = serializers.IntegerField(required=False)


class FichaSerieMensalSerializer(serializers.Serializer):
    titulo = serializers.CharField()
    definicao = serializers.CharField()
    meses = serializers.ListField(child=serializers.CharField(), help_text="AAAA-MM.")
    valores = serializers.ListField(child=serializers.IntegerField())
    fonte = serializers.CharField()


class FichaGraficosSerializer(serializers.Serializer):
    especies = FichaGraficoSerializer()
    condicao = FichaGraficoSerializer()
    ocorrencias_mensais = FichaSerieMensalSerializer()


class FichaComponenteSerializer(serializers.Serializer):
    id = serializers.CharField()
    rotulo = serializers.CharField()
    quantidade = serializers.IntegerField()
    peso = serializers.IntegerField()


class FichaRankingSerializer(serializers.Serializer):
    titulo = serializers.CharField()
    definicao = serializers.CharField()
    formula = serializers.CharField()
    posicao = serializers.IntegerField(allow_null=True, help_text="Nulo com índice zero.")
    total = serializers.IntegerField(help_text="Bairros do escopo com índice maior que zero.")
    indice = serializers.IntegerField()
    componentes = FichaComponenteSerializer(many=True)
    fonte = serializers.CharField()


class FichaRegionalSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    nome = serializers.CharField()


class FichaBairroSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    nome = serializers.CharField()
    codigo = serializers.CharField()
    regional = FichaRegionalSerializer(allow_null=True)
    area_km2 = serializers.FloatField(allow_null=True)
    oficial = serializers.BooleanField()
    selo = serializers.CharField()
    fonte = serializers.CharField()
    fonte_url = serializers.CharField()
    data_referencia = serializers.DateField(allow_null=True)
    limites = serializers.ListField(child=serializers.FloatField(), help_text="[O, S, L, N].")
    geometria = serializers.DictField(help_text="GeoJSON do polígono do bairro.")


class FichaSerializer(serializers.Serializer):
    gerado_em = serializers.DateTimeField()
    bairro = FichaBairroSerializer()
    cartoes = FichaCartaoSerializer(many=True)
    graficos = FichaGraficosSerializer()
    ranking = FichaRankingSerializer()
