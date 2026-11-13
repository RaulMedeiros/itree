"""Ações em lote sobre tarefas (G-07, M-23, M-26): o que cada ação altera."""

from datetime import date

from itree.contas.models import Equipe
from itree.contas.permissoes import Permissao as P
from itree.core.lote import Preparo, acao_em_lote
from itree.notificacoes import servicos as notificacoes

from .models import ESTADOS_FINAIS_TAREFA, Tarefa
from .views import filtrar_tarefas, tarefas_do_escopo


def _preparo(usuario, evento: str, alterar) -> Preparo:
    return Preparo(
        consulta=lambda: tarefas_do_escopo(usuario),
        filtrar=lambda qs, filtros: filtrar_tarefas(qs, usuario, filtros),
        finais=ESTADOS_FINAIS_TAREFA,
        alterar=alterar,
        evento=evento,
        permissao=P.TAREFAS_EDITAR,
    )


@acao_em_lote("tarefas", "equipe")
def equipe(usuario, parametros: dict) -> Preparo:
    nova = Equipe.objects.get(pk=parametros["equipe_id"])
    membros = set(nova.membros.values_list("pk", flat=True))

    def alterar(tarefa: Tarefa) -> None:
        tarefa.equipe = nova
        if tarefa.responsavel_id and tarefa.responsavel_id not in membros:
            tarefa.responsavel = None
        tarefa.save(update_fields=["equipe", "responsavel", "atualizado_em"])
        notificacoes.tarefa_atribuida(tarefa, autor=usuario)

    return _preparo(usuario, "tarefas_equipe_em_lote", alterar)


@acao_em_lote("tarefas", "prazo")
def prazo(usuario, parametros: dict) -> Preparo:
    novo = date.fromisoformat(parametros["prazo"]) if parametros["prazo"] else None

    def alterar(tarefa: Tarefa) -> None:
        tarefa.prazo = novo
        tarefa.save(update_fields=["prazo", "atualizado_em"])

    return _preparo(usuario, "tarefas_prazo_em_lote", alterar)
