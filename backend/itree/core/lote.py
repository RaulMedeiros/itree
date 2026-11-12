"""Ações em lote sobre linhas selecionadas de uma lista (ocorrências, tarefas)."""

from rest_framework import serializers
from rest_framework.exceptions import ValidationError

# Registros por ação em lote. A lista mostra 50 por página; o limite cobre várias páginas
# marcadas sem deixar uma única requisição alterar um número ilimitado de registros.
LIMITE_ACOES_EM_LOTE = 200


class IdsEmLoteSerializer(serializers.Serializer):
    """Quais registros a ação alcança: os marcados (``ids``) ou todos os filtrados (``filtros``)."""

    ids = serializers.ListField(
        child=serializers.UUIDField(),
        min_length=1,
        max_length=LIMITE_ACOES_EM_LOTE,
        required=False,
        help_text=f"Registros marcados na lista (de 1 a {LIMITE_ACOES_EM_LOTE}). "
        "Use `ids` ou `filtros`, nunca os dois.",
    )
    filtros = serializers.DictField(
        child=serializers.CharField(allow_blank=True),
        required=False,
        help_text="Os mesmos parâmetros da listagem (busca, estado, tipo, bairro...), no lugar "
        f"dos ids. Alcança todos os registros filtrados, até o limite de {LIMITE_ACOES_EM_LOTE}; "
        "com mais que isso, a ação é recusada.",
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

    def validate(self, attrs):
        if ("ids" in attrs) == ("filtros" in attrs):
            raise serializers.ValidationError("Informe `ids` ou `filtros`, um dos dois.")
        return attrs


class PrazoEmLoteSerializer(IdsEmLoteSerializer):
    prazo = serializers.DateField(
        allow_null=True, help_text="Novo prazo (AAAA-MM-DD). `null` remove o prazo."
    )


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


def resolver_ids_do_lote(validado: dict, escopo, filtrar) -> list:
    """Ids da ação: os enviados, ou os de todos os registros do escopo que passam nos filtros.

    ``escopo`` é a consulta já restrita ao território de quem pede e ``filtrar`` a mesma função
    da listagem, para "todos os filtrados" ser exatamente o que a lista mostra. Passando do
    limite, nada é alterado e o aviso diz quantos são.
    """
    if "ids" in validado:
        return validado["ids"]
    consulta = filtrar(escopo, validado["filtros"])
    total = consulta.count()
    if total == 0:
        raise ValidationError({"filtros": ["Nenhum registro corresponde aos filtros."]})
    if total > LIMITE_ACOES_EM_LOTE:
        raise ValidationError(
            {
                "filtros": [
                    f"Os filtros alcançam {total} registros; o limite é de "
                    f"{LIMITE_ACOES_EM_LOTE} por ação. Refine os filtros para continuar."
                ]
            }
        )
    return list(consulta.order_by().values_list("pk", flat=True))
