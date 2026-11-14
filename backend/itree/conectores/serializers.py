import re
from urllib.parse import urlsplit

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from . import seguranca, servico
from .models import (
    Conector,
    DestinoConector,
    ExecucaoConector,
    TipoConector,
)

PARAMETROS_CONHECIDOS = {
    "camada",
    "where",
    "tamanho_pagina",
    "pacote",
    "recurso",
    "campo_id",
    "coluna_latitude",
    "coluna_longitude",
}
OBRIGATORIOS = {TipoConector.WFS: "camada", TipoConector.CKAN: "pacote"}
NOMES_OBRIGATORIOS = {"camada": "a camada (typeName)", "pacote": "o pacote do CKAN"}


def validar_endereco(valor: str) -> str:
    """Esquema e host na hora de cadastrar. O DNS é conferido a cada busca."""
    partes = urlsplit(valor)
    if partes.scheme.lower() != "https":
        raise serializers.ValidationError("Só endereços HTTPS são aceitos.")
    host = (partes.hostname or "").lower()
    if host not in seguranca.hosts_permitidos():
        raise serializers.ValidationError(
            f"O host {host or valor} não está na lista de fontes permitidas do servidor."
        )
    if partes.username or partes.password:
        raise serializers.ValidationError("O endereço não pode conter usuário ou senha.")
    return valor


def validar_parametros(parametros: dict) -> dict:
    desconhecidos = set(parametros) - PARAMETROS_CONHECIDOS
    if desconhecidos:
        raise serializers.ValidationError(
            f"Parâmetros não reconhecidos: {', '.join(sorted(desconhecidos))}."
        )
    return {k: str(v).strip() for k, v in parametros.items() if str(v).strip()}


class ExecucaoConectorSerializer(serializers.ModelSerializer):
    usuario_nome = serializers.SerializerMethodField()
    lote_numero = serializers.SerializerMethodField()

    class Meta:
        model = ExecucaoConector
        fields = [
            "id",
            "origem",
            "usuario_nome",
            "iniciada_em",
            "concluida_em",
            "sucesso",
            "recebidos",
            "novos",
            "atualizados",
            "removidos",
            "invalidos",
            "erro",
            "detalhe",
            "lote",
            "lote_numero",
        ]
        read_only_fields = fields

    def get_usuario_nome(self, obj) -> str | None:
        return (obj.usuario.nome or obj.usuario.email) if obj.usuario else None

    def get_lote_numero(self, obj) -> int | None:
        return obj.lote.numero if obj.lote else None


class ConectorSerializer(serializers.ModelSerializer):
    parametros = serializers.DictField(
        child=serializers.CharField(allow_blank=True), required=False
    )
    rotulos = serializers.DictField(
        child=serializers.CharField(max_length=100),
        required=False,
        help_text="Propriedade → rótulo.",
    )
    modelo_importacao_nome = serializers.SerializerMethodField()
    situacao = serializers.SerializerMethodField()
    ultima_execucao = serializers.SerializerMethodField()
    total_feicoes = serializers.IntegerField(read_only=True, default=0)
    previa_pendente = serializers.SerializerMethodField()

    class Meta:
        model = Conector
        fields = [
            "id",
            "nome",
            "tipo",
            "url",
            "parametros",
            "destino",
            "modelo_importacao",
            "modelo_importacao_nome",
            "modo",
            "periodicidade",
            "ativo",
            "orgao",
            "licenca",
            "url_origem",
            "cor",
            "rotulos",
            "situacao",
            "ultima_execucao",
            "total_feicoes",
            "previa_pendente",
            "criado_em",
            "atualizado_em",
        ]
        read_only_fields = ["criado_em", "atualizado_em"]

    def get_modelo_importacao_nome(self, obj) -> str | None:
        return str(obj.modelo_importacao) if obj.modelo_importacao else None

    def get_situacao(self, obj) -> str:
        """nunca | sincronizando | falha | atrasado | ok"""
        return servico.situacao(obj, obj.execucoes.first())

    @extend_schema_field(ExecucaoConectorSerializer(allow_null=True))
    def get_ultima_execucao(self, obj) -> dict | None:
        ultima = obj.execucoes.select_related("usuario", "lote").first()
        return ExecucaoConectorSerializer(ultima).data if ultima else None

    def get_previa_pendente(self, obj) -> int | None:
        """Número do lote em prévia que este conector deixou aguardando confirmação."""
        lote = servico.previa_pendente(obj)
        return lote.numero if lote else None

    def validate_nome(self, valor):
        return valor.strip()

    def validate_url(self, valor):
        return validar_endereco(valor)

    def validate_cor(self, valor):
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", valor):
            raise serializers.ValidationError("Use uma cor no formato #rrggbb.")
        return valor

    def validate_parametros(self, valor):
        return validar_parametros(valor)

    def validate(self, dados):
        def atual(campo):
            return dados.get(campo, getattr(self.instance, campo, None))

        tipo, destino = atual("tipo"), atual("destino")
        parametros = atual("parametros") or {}
        exigido = OBRIGATORIOS.get(tipo)
        if exigido and not parametros.get(exigido):
            raise serializers.ValidationError(
                {"parametros": f"Informe {NOMES_OBRIGATORIOS[exigido]}."}
            )
        if destino == DestinoConector.LOTE_IMPORTACAO and not atual("modelo_importacao"):
            raise serializers.ValidationError(
                {"modelo_importacao": "Escolha o modelo de importação do lote."}
            )
        if destino == DestinoConector.CAMADA_REFERENCIA and atual("modelo_importacao"):
            dados["modelo_importacao"] = None
        return dados


class TestarConectorSerializer(serializers.Serializer):
    tipo = serializers.ChoiceField(choices=TipoConector.choices)
    url = serializers.URLField(max_length=500)
    parametros = serializers.DictField(
        child=serializers.CharField(allow_blank=True), required=False
    )

    def validate_url(self, valor):
        return validar_endereco(valor)

    def validate_parametros(self, valor):
        return validar_parametros(valor)

    def validate(self, dados):
        exigido = OBRIGATORIOS.get(dados["tipo"])
        if exigido and not dados.get("parametros", {}).get(exigido):
            raise serializers.ValidationError(
                {"parametros": f"Informe {NOMES_OBRIGATORIOS[exigido]}."}
            )
        return dados


class ResultadoTesteSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    paginas = serializers.IntegerField()
    colunas = serializers.ListField(child=serializers.CharField())
    amostra = serializers.ListField(child=serializers.DictField())


class CamadaReferenciaSerializer(serializers.ModelSerializer):
    rotulos = serializers.DictField(child=serializers.CharField(), read_only=True)
    total = serializers.IntegerField(read_only=True)
    atualizada_em = serializers.DateTimeField(read_only=True, allow_null=True)

    class Meta:
        model = Conector
        fields = [
            "id",
            "nome",
            "cor",
            "orgao",
            "licenca",
            "url_origem",
            "rotulos",
            "total",
            "atualizada_em",
        ]
        read_only_fields = fields
