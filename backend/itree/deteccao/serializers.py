"""Serializadores da detecção automática: lotes, sinais de remoção, pontos de plantio e
tokens de integração.

O valor do token só aparece na resposta de criação; a lista mostra apenas o prefixo."""

import json

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from itree.territorio.models import Territorio
from itree.territorio.serializers import TerritorioResumoSerializer

from .confianca import faixa_de_confianca
from .models import LoteDeteccao, PontoPlantio, SinalRemocao, TokenIntegracao


class LoteDeteccaoSerializer(serializers.ModelSerializer):
    enviado_por_nome = serializers.SerializerMethodField()
    integracao_nome = serializers.CharField(source="integracao.nome", default="", read_only=True)
    sensor_rotulo = serializers.CharField(source="get_sensor_display", read_only=True)
    situacao_rotulo = serializers.CharField(source="get_situacao_display", read_only=True)

    class Meta:
        model = LoteDeteccao
        fields = [
            "id",
            "id_externo",
            "projeto_origem",
            "versao_modelo",
            "sensor",
            "sensor_rotulo",
            "capturado_em",
            "canal",
            "arquivo_nome",
            "situacao",
            "situacao_rotulo",
            "total",
            "processadas",
            "arvores_criadas",
            "arvores_juntadas",
            "recusadas",
            "pontos_criados",
            "possiveis_remocoes",
            "enviado_por_nome",
            "integracao_nome",
            "erro",
            "criado_em",
            "processado_em",
        ]
        read_only_fields = fields

    def get_enviado_por_nome(self, obj) -> str:
        return obj.enviado_por.nome or obj.enviado_por.email


class ErroDeteccaoSerializer(serializers.Serializer):
    id = serializers.CharField()
    motivo = serializers.CharField()
    longitude = serializers.FloatField(required=False)
    latitude = serializers.FloatField(required=False)


class LoteDeteccaoDetalheSerializer(LoteDeteccaoSerializer):
    erros = ErroDeteccaoSerializer(many=True, read_only=True)
    area_coberta = serializers.SerializerMethodField()
    total_grupos = serializers.SerializerMethodField()

    class Meta(LoteDeteccaoSerializer.Meta):
        fields = [*LoteDeteccaoSerializer.Meta.fields, "erros", "area_coberta", "total_grupos"]
        read_only_fields = fields

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_area_coberta(self, obj):
        return json.loads(obj.area_coberta.geojson) if obj.area_coberta else None

    def get_total_grupos(self, obj) -> int | None:
        grupos = obj.carga.get("grupos") if obj.carga else None
        return len(grupos) if grupos is not None else None


class SinalRemocaoSerializer(serializers.ModelSerializer):
    arvore_id = serializers.UUIDField(read_only=True)
    arvore_codigo = serializers.CharField(source="arvore.codigo", read_only=True)
    arvore_origem = serializers.CharField(source="arvore.origem_registro", read_only=True)
    arvore_confirmada = serializers.BooleanField(source="arvore.confirmada", read_only=True)
    especie = serializers.SerializerMethodField()
    bairro = TerritorioResumoSerializer(source="arvore.bairro", read_only=True, allow_null=True)
    localizacao = serializers.SerializerMethodField()
    lote_id = serializers.UUIDField(read_only=True)
    lote_id_externo = serializers.CharField(source="lote.id_externo", read_only=True)
    lote_capturado_em = serializers.DateField(source="lote.capturado_em", read_only=True)
    lote_sensor = serializers.CharField(source="lote.sensor", read_only=True)
    ultima_vez_vista_em = serializers.DateTimeField(
        source="arvore.ultima_vez_vista_em", read_only=True
    )

    class Meta:
        model = SinalRemocao
        fields = [
            "id",
            "situacao",
            "arvore_id",
            "arvore_codigo",
            "arvore_origem",
            "arvore_confirmada",
            "especie",
            "bairro",
            "localizacao",
            "lote_id",
            "lote_id_externo",
            "lote_capturado_em",
            "lote_sensor",
            "ultima_vez_vista_em",
            "decidido_em",
            "motivo",
            "criado_em",
        ]
        read_only_fields = fields

    def get_especie(self, obj) -> str:
        return obj.arvore.especie.nome_cientifico if obj.arvore.especie else ""

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_localizacao(self, obj):
        g = obj.arvore.geom
        return {"longitude": g.x, "latitude": g.y} if g else None


class DecisaoRemocaoSerializer(serializers.Serializer):
    motivo = serializers.CharField(max_length=500)


class TokenIntegracaoSerializer(serializers.ModelSerializer):
    territorios = TerritorioResumoSerializer(many=True, read_only=True)
    territorios_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        write_only=True,
        source="territorios",
        queryset=Territorio.objects.all(),
        help_text="Escopo territorial do token (ao menos um território).",
    )
    ativo = serializers.BooleanField(read_only=True)
    total_lotes = serializers.IntegerField(read_only=True, default=0)
    criado_por_nome = serializers.SerializerMethodField()

    class Meta:
        model = TokenIntegracao
        fields = [
            "id",
            "nome",
            "prefixo",
            "permissoes",
            "territorios",
            "territorios_ids",
            "ativo",
            "criado_em",
            "criado_por_nome",
            "ultimo_uso_em",
            "revogado_em",
            "total_lotes",
        ]
        read_only_fields = ["prefixo", "permissoes", "criado_em", "ultimo_uso_em", "revogado_em"]

    def validate_territorios_ids(self, valor):
        if not valor:
            raise serializers.ValidationError("Escolha ao menos um território.")
        return valor

    def get_criado_por_nome(self, obj) -> str:
        return (obj.criado_por.nome or obj.criado_por.email) if obj.criado_por else ""


class TokenCriadoSerializer(TokenIntegracaoSerializer):
    token = serializers.CharField(
        read_only=True, help_text="Valor do token. É mostrado só nesta resposta; guarde-o."
    )

    class Meta(TokenIntegracaoSerializer.Meta):
        fields = [*TokenIntegracaoSerializer.Meta.fields, "token"]


class PontoPlantioSerializer(serializers.ModelSerializer):
    class Meta:
        model = PontoPlantio
        fields = ["id", "tipo", "confianca", "contexto", "capturado_em", "situacao"]


__all__ = ["faixa_de_confianca"]
