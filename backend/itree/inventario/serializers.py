from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from itree.core.geo import ponto
from itree.territorio.serializers import TerritorioResumoSerializer

from .models import (
    UNIDADES_POR_TIPO,
    Arvore,
    Especie,
    EstadoEspecie,
    EstadoLote,
    IdentificadorExterno,
    LoteImportacao,
    Medida,
    MetodoMedida,
    OrigemLocalizacao,
    OrigemValor,
)


class LocalizacaoSerializer(serializers.Serializer):
    longitude = serializers.FloatField(min_value=-180, max_value=180)
    latitude = serializers.FloatField(min_value=-90, max_value=90)


class CampoLocalizacao(serializers.Field):
    """Ponto WGS 84 como {longitude, latitude}."""

    def to_representation(self, valor):
        return {"longitude": valor.x, "latitude": valor.y} if valor else None

    def to_internal_value(self, dados):
        s = LocalizacaoSerializer(data=dados)
        s.is_valid(raise_exception=True)
        return ponto(s.validated_data["longitude"], s.validated_data["latitude"])


extend_schema_field(LocalizacaoSerializer(allow_null=True))(CampoLocalizacao)


class EspecieSerializer(serializers.ModelSerializer):
    sucessora = serializers.PrimaryKeyRelatedField(
        queryset=Especie.objects.all(), allow_null=True, required=False
    )

    class Meta:
        model = Especie
        fields = [
            "id",
            "nome_cientifico",
            "familia",
            "nomes_comuns",
            "nativa_brasil",
            "ativa",
            "sucessora",
            "fonte_taxonomica",
        ]


class EspecieResumoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Especie
        fields = ["id", "nome_cientifico", "nomes_comuns"]


class MedidaSerializer(serializers.ModelSerializer):
    responsavel_nome = serializers.SerializerMethodField()

    class Meta:
        model = Medida
        fields = [
            "id",
            "tipo",
            "valor",
            "unidade",
            "metodo",
            "origem",
            "data_medicao",
            "responsavel_nome",
            "observacao",
            "criado_em",
        ]
        read_only_fields = ["unidade", "criado_em"]

    def get_responsavel_nome(self, obj) -> str:
        if obj.responsavel:
            return obj.responsavel.nome or obj.responsavel.email
        return obj.responsavel_texto

    def validate(self, attrs):
        metodo, origem = attrs.get("metodo"), attrs.get("origem")
        estimativos = {MetodoMedida.VISUAL, MetodoMedida.IMAGEM}
        if origem == OrigemValor.MEDIDO and metodo in estimativos:
            raise serializers.ValidationError(
                {
                    "origem": "Estimativas visuais ou por imagem não podem ser registradas "
                    "como medidas."
                }
            )
        if origem == OrigemValor.IMPORTADO:
            raise serializers.ValidationError(
                {"origem": "Valores importados só entram por importação em lote."}
            )
        if attrs.get("valor") is not None and attrs["valor"] <= 0:
            raise serializers.ValidationError({"valor": "O valor deve ser positivo."})
        return attrs

    def create(self, validated_data):
        validated_data["unidade"] = UNIDADES_POR_TIPO[validated_data["tipo"]]
        return super().create(validated_data)


class IdentificadorExternoSerializer(serializers.ModelSerializer):
    class Meta:
        model = IdentificadorExterno
        fields = ["fonte", "valor"]


class ArvoreResumoSerializer(serializers.ModelSerializer):
    codigo = serializers.CharField(read_only=True)
    especie = EspecieResumoSerializer(read_only=True, allow_null=True)
    localizacao = CampoLocalizacao(source="geom", read_only=True)
    bairro = TerritorioResumoSerializer(read_only=True)
    valida = serializers.BooleanField(read_only=True)
    ocorrencias_abertas = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Arvore
        fields = [
            "id",
            "codigo",
            "especie",
            "especie_estado",
            "especie_texto_original",
            "localizacao",
            "localizacao_origem",
            "precisao_m",
            "endereco",
            "bairro",
            "situacao",
            "valida",
            "origem_registro",
            "ocorrencias_abertas",
            "condicao_aparente",
            "condicao_aparente_em",
            "ultima_inspecao_em",
            "criado_em",
            "atualizado_em",
        ]
        read_only_fields = ["condicao_aparente", "condicao_aparente_em", "ultima_inspecao_em"]


class ArvoreSerializer(ArvoreResumoSerializer):
    """Detalhe e edição. Campos validados exigem justificativa (RF-INV-009)."""

    especie_id = serializers.PrimaryKeyRelatedField(
        source="especie",
        queryset=Especie.objects.filter(ativa=True),
        allow_null=True,
        required=False,
        write_only=True,
    )
    localizacao = CampoLocalizacao(source="geom", required=False, allow_null=True)
    identificadores = IdentificadorExternoSerializer(many=True, read_only=True)
    medidas_atuais = serializers.SerializerMethodField()
    fundida_em = serializers.SerializerMethodField()
    lote = serializers.SerializerMethodField()
    criado_por_nome = serializers.SerializerMethodField()
    motivo = serializers.CharField(
        write_only=True, required=False, allow_blank=True, max_length=500
    )

    class Meta(ArvoreResumoSerializer.Meta):
        fields = [
            *ArvoreResumoSerializer.Meta.fields,
            "especie_id",
            "identificadores",
            "medidas_atuais",
            "fundida_em",
            "motivo_situacao",
            "lote",
            "criado_por_nome",
            "observacoes",
            "motivo",
        ]
        read_only_fields = [
            "situacao",
            "origem_registro",
            "motivo_situacao",
            "condicao_aparente",
            "condicao_aparente_em",
            "ultima_inspecao_em",
        ]

    @extend_schema_field(MedidaSerializer(many=True))
    def get_medidas_atuais(self, obj):
        """Medida mais recente de cada tipo."""
        atuais = {}
        for medida in obj.medidas.filter(aplicada=True).select_related("responsavel"):
            atuais.setdefault(medida.tipo, medida)
        return MedidaSerializer(atuais.values(), many=True).data

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_fundida_em(self, obj):
        return str(obj.fundida_em_id) if obj.fundida_em_id else None

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_lote(self, obj):
        if not obj.lote_id:
            return None
        return {"id": str(obj.lote_id), "numero": obj.lote.numero, "fonte": obj.lote.fonte}

    def get_criado_por_nome(self, obj) -> str:
        return (obj.criado_por.nome or obj.criado_por.email) if obj.criado_por else ""

    def validate(self, attrs):
        request = self.context["request"]
        instancia = self.instance
        estado_novo = attrs.get("especie_estado")
        if estado_novo == EstadoEspecie.CONFIRMADA and not request.user.tem_permissao(
            "inspecoes.validar"
        ):
            raise serializers.ValidationError(
                {"especie_estado": "Só revisores podem confirmar a espécie."}
            )
        if estado_novo == EstadoEspecie.SUGERIDA_IA:
            raise serializers.ValidationError(
                {"especie_estado": "Sugestões de IA são registradas pelo serviço de inferência."}
            )
        if "geom" in attrs and attrs["geom"] is not None:
            attrs.setdefault("localizacao_origem", OrigemLocalizacao.ESTIMADA_WEB)
            if attrs["localizacao_origem"] == OrigemLocalizacao.GPS_CAMPO:
                raise serializers.ValidationError(
                    {"localizacao_origem": "Localização GPS de campo só vem do aplicativo."}
                )
        if instancia is not None:
            validados = []
            if instancia.especie_estado == EstadoEspecie.CONFIRMADA and (
                ("especie" in attrs and attrs["especie"] != instancia.especie)
                or (estado_novo and estado_novo != instancia.especie_estado)
            ):
                validados.append("espécie confirmada")
            if instancia.localizacao_origem == OrigemLocalizacao.GPS_CAMPO and "geom" in attrs:
                validados.append("localização de campo")
            if validados and not attrs.get("motivo", "").strip():
                raise serializers.ValidationError(
                    {"motivo": f"Informe a justificativa para alterar {', '.join(validados)}."}
                )
        return attrs

    def create(self, validated_data):
        validated_data.pop("motivo", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("motivo", None)
        return super().update(instance, validated_data)


class AcaoComMotivoSerializer(serializers.Serializer):
    motivo = serializers.CharField(max_length=500)


class FusaoSerializer(serializers.Serializer):
    descartar = serializers.PrimaryKeyRelatedField(queryset=Arvore.objects.all())
    campos_da_outra = serializers.ListField(
        child=serializers.CharField(), required=False, default=list
    )
    motivo = serializers.CharField(max_length=500)


class ParDuplicidadeSerializer(serializers.Serializer):
    arvore_a = ArvoreResumoSerializer()
    arvore_b = ArvoreResumoSerializer()
    distancia_m = serializers.FloatField()
    criterio = serializers.CharField()


class ParRevisadoSerializer(serializers.Serializer):
    arvore_a = serializers.PrimaryKeyRelatedField(queryset=Arvore.objects.all())
    arvore_b = serializers.PrimaryKeyRelatedField(queryset=Arvore.objects.all())


class LinhaImportacaoSerializer(serializers.Serializer):
    indice = serializers.IntegerField()
    dados = serializers.DictField()
    erros = serializers.ListField(child=serializers.CharField())
    avisos = serializers.ListField(child=serializers.CharField())


class LoteImportacaoSerializer(serializers.ModelSerializer):
    usuario_nome = serializers.SerializerMethodField()
    pode_desfazer = serializers.SerializerMethodField()
    motivo_nao_desfazer = serializers.SerializerMethodField()
    arvores_criadas = serializers.SerializerMethodField()

    class Meta:
        model = LoteImportacao
        fields = [
            "id",
            "numero",
            "arquivo_nome",
            "formato",
            "fonte",
            "fonte_url",
            "data_referencia",
            "mapeamento",
            "estado",
            "usuario_nome",
            "total_linhas",
            "linhas_validas",
            "arvores_criadas",
            "confirmado_em",
            "desfeito_em",
            "criado_em",
            "pode_desfazer",
            "motivo_nao_desfazer",
        ]

    def get_usuario_nome(self, obj) -> str:
        return obj.usuario.nome or obj.usuario.email

    def get_arvores_criadas(self, obj) -> int:
        return obj.arvores.count()

    def _motivo(self, obj):
        from .importacao import motivo_impede_desfazer

        return motivo_impede_desfazer(obj)

    def get_pode_desfazer(self, obj) -> bool:
        return obj.estado == EstadoLote.CONFIRMADO and self._motivo(obj) is None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_motivo_nao_desfazer(self, obj):
        return self._motivo(obj) if obj.estado == EstadoLote.CONFIRMADO else None


class LoteImportacaoDetalheSerializer(LoteImportacaoSerializer):
    linhas = LinhaImportacaoSerializer(many=True, read_only=True)

    class Meta(LoteImportacaoSerializer.Meta):
        fields = [*LoteImportacaoSerializer.Meta.fields, "linhas"]


class NovaImportacaoSerializer(serializers.Serializer):
    arquivo = serializers.FileField()
    fonte = serializers.CharField(max_length=200)
    fonte_url = serializers.URLField(required=False, allow_blank=True)
    data_referencia = serializers.DateField(required=False, allow_null=True)
    srid = serializers.IntegerField(default=4326)
    campo_latitude = serializers.CharField(required=False, allow_blank=True)
    campo_longitude = serializers.CharField(required=False, allow_blank=True)
    campo_id_externo = serializers.CharField(required=False, allow_blank=True)
    campo_especie = serializers.CharField(required=False, allow_blank=True)
    campo_endereco = serializers.CharField(required=False, allow_blank=True)
    campo_altura = serializers.CharField(required=False, allow_blank=True)
    campo_dap = serializers.CharField(required=False, allow_blank=True)
    campo_precisao = serializers.CharField(required=False, allow_blank=True)


class ColunasArquivoSerializer(serializers.Serializer):
    arquivo = serializers.FileField()


class ContadoresSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    validos = serializers.IntegerField()
