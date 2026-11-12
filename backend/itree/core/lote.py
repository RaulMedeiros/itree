"""Ações em lote sobre linhas selecionadas de uma lista (ocorrências, tarefas)."""

from rest_framework import serializers

# Registros por ação em lote. A lista mostra 50 por página; o limite cobre várias páginas
# marcadas sem deixar uma única requisição alterar um número ilimitado de registros.
LIMITE_ACOES_EM_LOTE = 200


class IdsEmLoteSerializer(serializers.Serializer):
    ids = serializers.ListField(
        child=serializers.UUIDField(),
        min_length=1,
        max_length=LIMITE_ACOES_EM_LOTE,
        help_text=f"Registros marcados na lista (de 1 a {LIMITE_ACOES_EM_LOTE}).",
    )
    motivo = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        help_text="Fica no histórico de cada registro alterado.",
    )

    def validate_ids(self, ids):
        # Repetidos contariam duas vezes; a ordem da seleção é preservada.
        return list(dict.fromkeys(ids))


class IgnoradoEmLoteSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    codigo = serializers.CharField(allow_blank=True)
    motivo = serializers.CharField()


class ResultadoAcaoEmLoteSerializer(serializers.Serializer):
    atualizadas = serializers.IntegerField(help_text="Registros alterados.")
    ignoradas = IgnoradoEmLoteSerializer(
        many=True,
        help_text="Registros que não foram alterados, com o motivo de cada um.",
    )


MOTIVO_FORA_DO_ESCOPO = "Não encontrado no seu escopo territorial."
MOTIVO_ENCERRADA = "Já foi encerrada."


def ignorados_fora_do_escopo(ids, encontrados) -> list[dict]:
    """Ids pedidos que não vieram da consulta com escopo: inexistentes ou fora da área."""
    achados = {str(i) for i in encontrados}
    return [
        {"id": i, "codigo": "", "motivo": MOTIVO_FORA_DO_ESCOPO}
        for i in ids
        if str(i) not in achados
    ]
