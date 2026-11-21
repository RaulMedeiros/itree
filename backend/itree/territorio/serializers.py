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


class FichaEscalaSerializer(serializers.Serializer):
    min = serializers.FloatField()
    max = serializers.FloatField()


class FichaCartaoSerializer(serializers.Serializer):
    id = serializers.CharField()
    titulo = serializers.CharField()
    valor = serializers.FloatField(allow_null=True, help_text="Nulo quando ``sem_dado``.")
    unidade = serializers.CharField(
        help_text='"%", "°C", "R$", "hab/km²", "por 1.000 hab.", "IDH", "pessoas" ou vazio.'
    )
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
    escala = FichaEscalaSerializer(
        allow_null=True,
        required=False,
        help_text="Menor e maior valor entre os bairros: escala da régua dos indicadores que não "
        "são percentuais.",
    )


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


class FichaParteRegraSerializer(serializers.Serializer):
    id = serializers.ChoiceField(choices=["3", "30", "300"])
    nome = serializers.CharField()
    meta = serializers.CharField(help_text='"3 árvores a até 30 m", "30% de cobertura"...')
    meta_pct = serializers.FloatField(
        help_text="Percentual que o bairro precisa atingir para a parte atender."
    )
    unidade = serializers.CharField()
    valor = serializers.FloatField(allow_null=True, help_text="Percentual; nulo sem dado.")
    numerador = serializers.IntegerField(allow_null=True)
    denominador = serializers.IntegerField(allow_null=True)
    cidade = serializers.FloatField(allow_null=True)
    atende = serializers.BooleanField(allow_null=True, help_text="Nulo sem dado.")
    sem_dado = serializers.BooleanField()
    nota = serializers.CharField()
    definicao = serializers.CharField()


class FichaRegra330300Serializer(serializers.Serializer):
    contagem = serializers.ChoiceField(choices=["todas", "confirmadas"])
    calculado_em = serializers.DateTimeField(allow_null=True)
    data = serializers.DateField(allow_null=True)
    base_edificacoes = serializers.CharField(help_text='"residenciais", "todas" ou vazio.')
    base_texto = serializers.CharField()
    edificacoes = serializers.IntegerField()
    classificadas = serializers.IntegerField(allow_null=True)
    edificacoes_no_bairro = serializers.IntegerField(allow_null=True)
    limiar_ndvi = serializers.FloatField(allow_null=True)
    partes = FichaParteRegraSerializer(many=True)
    regra = serializers.CharField()
    fonte_metodo = serializers.CharField()
    fonte_url = serializers.CharField()
    metodo = serializers.CharField()
    ressalva = serializers.CharField()
    rotulo_cidade = serializers.CharField()


class FichaZonaSerializer(serializers.Serializer):
    nome = serializers.CharField()
    sigla = serializers.CharField()
    pct = serializers.FloatField(help_text="Percentual da área do bairro nesta zona.")


class FichaMacrozoneamentoSerializer(serializers.Serializer):
    zonas = FichaZonaSerializer(many=True)
    predominante = serializers.CharField()
    fonte = serializers.CharField()
    fonte_url = serializers.CharField()
    licenca = serializers.CharField()
    data_referencia = serializers.DateField()


class FichaSerializer(serializers.Serializer):
    gerado_em = serializers.DateTimeField()
    bairro = FichaBairroSerializer()
    cartoes = FichaCartaoSerializer(many=True)
    regra_3_30_300 = FichaRegra330300Serializer()
    macrozoneamento = FichaMacrozoneamentoSerializer(allow_null=True)
    graficos = FichaGraficosSerializer()
    ranking = FichaRankingSerializer()
