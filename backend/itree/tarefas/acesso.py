"""Quem pode mudar o andamento de uma tarefa."""

from itree.contas.permissoes import Permissao


def pode_atuar(usuario, tarefa) -> bool:
    """Responsável, membro da equipe atribuída ou coordenação (tarefas.editar)."""
    return bool(
        usuario.tem_permissao(Permissao.TAREFAS_EDITAR)
        or tarefa.responsavel_id == usuario.pk
        or (tarefa.equipe_id and tarefa.equipe.membros.filter(pk=usuario.pk).exists())
    )
