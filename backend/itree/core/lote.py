"""Ações em lote sobre linhas selecionadas de uma lista (ocorrências, tarefas, alertas).

Até ``LIMITE_ACOES_EM_LOTE`` registros a ação roda na própria requisição. Acima disso (só com
"todos os filtrados") vira uma ``OperacaoEmLote`` executada em tarefa Celery, com
acompanhamento por ``GET /operacoes-em-lote/{id}`` (M-26).
"""

import logging
import uuid
from collections.abc import Callable
from contextlib import nullcontext
from dataclasses import dataclass
from typing import Any

import pghistory
from django.db import transaction
from django.db.models import QuerySet
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .models import EstadoOperacao, OperacaoEmLote

logger = logging.getLogger(__name__)

# Registros por ação em lote que rodam na própria requisição. A lista mostra 50 por página; o
# limite cobre várias páginas marcadas sem deixar uma requisição alterar um número ilimitado.
LIMITE_ACOES_EM_LOTE = 200
# "Todos os filtrados" acima do limite síncrono vira operação em segundo plano, até este total.
LIMITE_OPERACAO_EM_LOTE = 20_000
# Registros por transação na execução em segundo plano: o andamento é gravado a cada bloco.
TAMANHO_BLOCO = 100
# Motivos guardados por operação; os demais só entram na contagem de falhas.
LIMITE_MOTIVOS_GUARDADOS = 500


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
        f"dos ids. Alcança todos os registros filtrados. Até {LIMITE_ACOES_EM_LOTE} a ação é "
        "imediata (200); acima disso, roda em segundo plano (202, com uma operação para "
        f"acompanhar), até {LIMITE_OPERACAO_EM_LOTE}; com mais que isso, é recusada.",
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
        {"id": str(i), "codigo": "", "motivo": MOTIVO_FORA_DO_ESCOPO}
        for i in ids
        if str(i) not in achados
    ]


def resolver_ids_do_lote(validado: dict, escopo, filtrar) -> list:
    """Ids da ação: os enviados, ou os de todos os registros do escopo que passam nos filtros.

    ``escopo`` é a consulta já restrita ao território de quem pede e ``filtrar`` a mesma função
    da listagem, para "todos os filtrados" ser exatamente o que a lista mostra. Passando do
    limite da operação em segundo plano, nada é alterado e o aviso diz quantos são.
    """
    if "ids" in validado:
        return validado["ids"]
    consulta = filtrar(escopo, validado["filtros"])
    total = consulta.count()
    if total == 0:
        raise ValidationError({"filtros": ["Nenhum registro corresponde aos filtros."]})
    if total > LIMITE_OPERACAO_EM_LOTE:
        raise ValidationError(
            {
                "filtros": [
                    f"Os filtros alcançam {total} registros; o limite é de "
                    f"{LIMITE_OPERACAO_EM_LOTE} por ação. Refine os filtros para continuar."
                ]
            }
        )
    return list(consulta.order_by().values_list("pk", flat=True))


# --- Execução ------------------------------------------------------------------------------


class RegistroIgnorado(Exception):
    """Levantada por ``alterar`` para deixar um registro como está, dizendo o motivo."""

    def __init__(self, motivo: str):
        super().__init__(motivo)
        self.motivo = motivo


@dataclass(frozen=True)
class Preparo:
    """Tudo o que a ação precisa para rodar, na requisição ou em segundo plano."""

    consulta: Callable[[], QuerySet]  # registros do escopo de quem pediu
    filtrar: Callable[[QuerySet, dict], QuerySet]  # os filtros da própria lista
    finais: Any  # estados que não aceitam mais alteração
    alterar: Callable[[Any], None]
    evento: str  # nome do evento na auditoria
    campo_estado: str = "estado"


ACOES: dict[tuple[str, str], Callable[[Any, dict], Preparo]] = {}


def acao_em_lote(recurso: str, acao: str):
    """Registra ``preparar(usuario, parametros) -> Preparo``; ``parametros`` é JSON puro."""

    def registrar(preparar):
        ACOES[(recurso, acao)] = preparar
        return preparar

    return registrar


def carregar_acoes() -> None:
    """Importa os módulos que registram as ações (a tarefa Celery não passa pelas views)."""
    from itree.alertas import lote as _alertas  # noqa: F401
    from itree.ocorrencias import lote as _ocorrencias  # noqa: F401
    from itree.tarefas import lote as _tarefas  # noqa: F401


def aplicar_a_ids(
    preparo: Preparo,
    ids: list,
    motivo: str,
    *,
    contexto: dict | None = None,
    isolar_falhas: bool = False,
) -> tuple[int, list[dict]]:
    """Aplica a ação a um bloco de ids, em uma transação.

    Devolve quantos mudaram e, dos que não mudaram, o motivo de cada um (fora do escopo,
    encerrado ou recusado pela própria ação). Com ``isolar_falhas``, um erro inesperado em um
    registro desfaz só aquele registro e vira motivo; sem ele, o erro desfaz o bloco inteiro.
    """
    atualizadas = 0
    with (
        transaction.atomic(),
        pghistory.context(motivo=motivo or None, evento=preparo.evento, **(contexto or {})),
    ):
        encontrados = {
            o.pk: o for o in preparo.consulta().filter(pk__in=ids).select_for_update(of=("self",))
        }
        ignoradas = ignorados_fora_do_escopo(ids, encontrados)
        for pk in ids:
            registro = encontrados.get(pk)
            if registro is None:
                continue
            codigo = getattr(registro, "codigo", "")
            if getattr(registro, preparo.campo_estado) in preparo.finais:
                ignoradas.append({"id": str(pk), "codigo": codigo, "motivo": MOTIVO_ENCERRADA})
                continue
            try:
                with transaction.atomic() if isolar_falhas else nullcontext():
                    preparo.alterar(registro)
            except RegistroIgnorado as recusa:
                ignoradas.append({"id": str(pk), "codigo": codigo, "motivo": recusa.motivo})
            except Exception:
                if not isolar_falhas:
                    raise
                logger.exception("Falha ao alterar %s em lote", pk)
                ignoradas.append({"id": str(pk), "codigo": codigo, "motivo": MOTIVO_FALHA})
            else:
                atualizadas += 1
    return atualizadas, ignoradas


MOTIVO_FALHA = "Erro inesperado ao alterar este registro."


def iniciar_acao_em_lote(
    usuario, recurso: str, acao: str, validado: dict, parametros: dict
) -> Response:
    """Roda a ação na hora (até o limite) ou cria a operação em segundo plano.

    ``validado`` é o corpo já validado (``ids`` ou ``filtros``, e ``motivo``); ``parametros`` são
    os dados próprios da ação, em JSON puro, que a execução em segundo plano relê.
    """
    from .tasks import executar_operacao_em_lote

    carregar_acoes()
    preparo = ACOES[(recurso, acao)](usuario, parametros)
    ids = resolver_ids_do_lote(validado, preparo.consulta(), preparo.filtrar)
    motivo = validado.get("motivo", "").strip()
    if len(ids) <= LIMITE_ACOES_EM_LOTE:
        atualizadas, ignoradas = aplicar_a_ids(preparo, ids, motivo)
        return Response({"atualizadas": atualizadas, "ignoradas": ignoradas})
    operacao = OperacaoEmLote.objects.create(
        usuario=usuario,
        recurso=recurso,
        acao=acao,
        total=len(ids),
        parametros={"ids": [str(i) for i in ids], "motivo": motivo, "acao": parametros},
    )
    try:
        executar_operacao_em_lote.delay(str(operacao.pk))
    except Exception:  # noqa: BLE001 - sem fila a operação não pode ficar "na fila" para sempre
        logger.exception("Não foi possível enfileirar a operação %s", operacao.pk)
        operacao.estado = EstadoOperacao.FALHOU
        operacao.erro = "Não foi possível colocar a operação na fila. Tente novamente."
        operacao.concluida_em = timezone.now()
        operacao.save(update_fields=["estado", "erro", "concluida_em", "atualizado_em"])
    return Response(OperacaoEmLoteSerializer(operacao).data, status=status.HTTP_202_ACCEPTED)


def executar_operacao(operacao_id) -> None:
    """Corpo da tarefa Celery: processa a operação em blocos, gravando o andamento a cada um."""
    carregar_acoes()
    operacao = OperacaoEmLote.objects.select_related("usuario").get(pk=operacao_id)
    if operacao.estado != EstadoOperacao.PENDENTE:  # reentrega da mensagem
        return
    operacao.estado = EstadoOperacao.EM_ANDAMENTO
    operacao.iniciada_em = timezone.now()
    operacao.save(update_fields=["estado", "iniciada_em", "atualizado_em"])
    try:
        usuario = operacao.usuario
        preparo = ACOES[(operacao.recurso, operacao.acao)](usuario, operacao.parametros["acao"])
        ids = [uuid.UUID(i) for i in operacao.parametros["ids"]]
        # O usuário e a origem entram na auditoria como entrariam numa requisição.
        contexto = {
            "user": str(usuario.pk),
            "origem": "web",
            "operacao": str(operacao.pk),
        }
        for inicio in range(0, len(ids), TAMANHO_BLOCO):
            bloco = ids[inicio : inicio + TAMANHO_BLOCO]
            atualizadas, ignoradas = aplicar_a_ids(
                preparo,
                bloco,
                operacao.parametros.get("motivo", ""),
                contexto=contexto,
                isolar_falhas=True,
            )
            operacao.processados += len(bloco)
            operacao.atualizadas += atualizadas
            operacao.falhas += len(ignoradas)
            espaco = LIMITE_MOTIVOS_GUARDADOS - len(operacao.motivos)
            operacao.motivos = [*operacao.motivos, *ignoradas[: max(espaco, 0)]]
            operacao.save(
                update_fields=["processados", "atualizadas", "falhas", "motivos", "atualizado_em"]
            )
        operacao.estado = EstadoOperacao.CONCLUIDA
    except Exception:
        logger.exception("A operação em lote %s foi interrompida", operacao.pk)
        operacao.estado = EstadoOperacao.FALHOU
        operacao.erro = (
            "A operação foi interrompida por um erro inesperado. Os registros já processados "
            "foram alterados; confira a lista e repita a ação para os demais."
        )
    operacao.concluida_em = timezone.now()
    operacao.save(update_fields=["estado", "erro", "concluida_em", "atualizado_em"])


class OperacaoEmLoteSerializer(serializers.ModelSerializer):
    """Andamento e resultado de uma ação em lote em segundo plano."""

    motivos_omitidos = serializers.SerializerMethodField(
        help_text="Registros não alterados cujo motivo não foi guardado (passou do limite)."
    )
    motivos = IgnoradoEmLoteSerializer(many=True, read_only=True)

    class Meta:
        model = OperacaoEmLote
        fields = [
            "id",
            "recurso",
            "acao",
            "estado",
            "total",
            "processados",
            "atualizadas",
            "falhas",
            "motivos",
            "motivos_omitidos",
            "erro",
            "criado_em",
            "iniciada_em",
            "concluida_em",
        ]
        read_only_fields = fields

    def get_motivos_omitidos(self, obj) -> int:
        return max(obj.falhas - len(obj.motivos), 0)
