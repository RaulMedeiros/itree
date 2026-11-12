"""Geração de notificações nos eventos-chave.

Cada função só agenda a gravação com ``transaction.on_commit``: se a transação
do evento for desfeita, ninguém é notificado. Quem recebe respeita permissão e
escopo territorial, e o autor da ação nunca notifica a si mesmo.
"""

from collections.abc import Iterable

from django.db import transaction

from itree.alertas.escopo import alerta_no_escopo
from itree.contas.acesso import area_do_escopo
from itree.contas.models import Usuario
from itree.contas.permissoes import Permissao

from .models import Notificacao, PreferenciaNotificacao, TipoNotificacao


def destinatarios(permissao: str, geom, excluir=()) -> list[Usuario]:
    """Usuários ativos com a permissão e escopo que alcança ``geom``."""
    fora = {u.pk if hasattr(u, "pk") else u for u in excluir if u is not None}
    candidatos = Usuario.objects.filter(is_active=True).exclude(pk__in=fora)
    return [u for u in candidatos if u.tem_permissao(permissao) and _alcanca(u, geom)]


def _alcanca(usuario: Usuario, geom) -> bool:
    area = area_do_escopo(usuario)
    return area is not None and (geom is None or area.intersects(geom))


def preferencias_do_usuario(usuario) -> dict[str, tuple[bool, bool]]:
    """Por tipo, ``(ativa, email)``. Tipos sem registro seguem o padrão: sino sim, e-mail não."""
    escolhas = {t: (True, False) for t in TipoNotificacao.values}
    for p in PreferenciaNotificacao.objects.filter(usuario=usuario):
        escolhas[p.tipo] = (p.ativa, p.ativa and p.email)
    return escolhas


def _agendar(usuarios: Iterable[Usuario], tipo: str, titulo: str, texto: str, link: str) -> None:
    ids = [u.pk for u in usuarios]
    if not ids:
        return

    def gravar() -> None:
        # A preferência vale na hora de gravar: quem silenciou o tipo não recebe nada.
        silenciam = set(
            PreferenciaNotificacao.objects.filter(
                usuario_id__in=ids, tipo=tipo, ativa=False
            ).values_list("usuario_id", flat=True)
        )
        por_email = set(
            PreferenciaNotificacao.objects.filter(
                usuario_id__in=ids, tipo=tipo, ativa=True, email=True
            ).values_list("usuario_id", flat=True)
        )
        criadas = Notificacao.objects.bulk_create(
            [
                Notificacao(usuario_id=i, tipo=tipo, titulo=titulo, texto=texto, link=link)
                for i in ids
                if i not in silenciam
            ]
        )
        for_email = [str(n.pk) for n in criadas if n.usuario_id in por_email]
        if for_email:
            from .tasks import enfileirar_emails

            enfileirar_emails(for_email)

    transaction.on_commit(gravar)


def tarefa_atribuida(tarefa, autor=None) -> None:
    """Equipe atribuída: membros no escopo do local. Responsável direto também."""
    alvo = {}
    if tarefa.equipe_id:
        for m in tarefa.equipe.membros.filter(is_active=True):
            alvo[m.pk] = m
    if tarefa.responsavel_id:
        alvo[tarefa.responsavel_id] = tarefa.responsavel
    recebem = [
        u
        for u in alvo.values()
        if u.pk != getattr(autor, "pk", None)
        and u.tem_permissao(Permissao.TAREFAS_LER)
        and _alcanca(u, tarefa.geom)
    ]
    _agendar(
        recebem,
        TipoNotificacao.TAREFA_ATRIBUIDA,
        f"Tarefa {tarefa.codigo} atribuída",
        tarefa.descricao[:200] or tarefa.get_tipo_display(),
        "/equipes-tarefas?responsavel=eu",
    )


def tarefa_concluida_ou_bloqueada(tarefa, autor=None) -> None:
    """Quem criou a tarefa sabe quando ela foi concluída ou bloqueada (e por quê).

    Não notifica quando a própria pessoa fez a mudança.
    """
    from itree.tarefas.models import EstadoTarefa

    criador = tarefa.criada_por
    if (
        tarefa.estado not in (EstadoTarefa.CONCLUIDA, EstadoTarefa.BLOQUEADA)
        or criador.pk == getattr(autor, "pk", None)
        or not criador.is_active
        or not criador.tem_permissao(Permissao.TAREFAS_LER)
        or not _alcanca(criador, tarefa.geom)
    ):
        return
    if tarefa.estado == EstadoTarefa.CONCLUIDA:
        tipo, titulo, texto = (
            TipoNotificacao.TAREFA_CONCLUIDA,
            f"Tarefa {tarefa.codigo} concluída",
            tarefa.get_tipo_display(),
        )
    else:
        tipo, titulo, texto = (
            TipoNotificacao.TAREFA_BLOQUEADA,
            f"Tarefa {tarefa.codigo} bloqueada",
            tarefa.motivo_estado[:200],
        )
    _agendar([criador], tipo, titulo, texto, "/equipes-tarefas")


def risco_confirmado(ocorrencia, autor=None) -> None:
    recebem = destinatarios(Permissao.OCORRENCIAS_PRIORIZAR, ocorrencia.geom, excluir=[autor])
    _agendar(
        recebem,
        TipoNotificacao.RISCO_CONFIRMADO,
        f"Risco confirmado na ocorrência {ocorrencia.codigo}",
        ocorrencia.risco_descricao[:200],
        f"/ocorrencias/{ocorrencia.pk}",
    )


def inspecao_devolvida(inspecao, motivo: str) -> None:
    tecnico = inspecao.tecnico
    if not tecnico.is_active:
        return
    _agendar(
        [tecnico],
        TipoNotificacao.INSPECAO_DEVOLVIDA,
        f"Inspeção {inspecao.codigo} devolvida para correção",
        motivo[:200],
        f"/inspecoes/{inspecao.pk}",
    )


def inspecao_para_revisao(inspecao) -> None:
    recebem = destinatarios(
        Permissao.INSPECOES_VALIDAR, inspecao.arvore.geom, excluir=[inspecao.tecnico_id]
    )
    _agendar(
        recebem,
        TipoNotificacao.INSPECAO_PARA_REVISAO,
        f"Inspeção {inspecao.codigo} aguardando revisão",
        "",
        f"/inspecoes/{inspecao.pk}",
    )


def alertas_novos(alertas: list) -> None:
    """Um aviso por usuário e ingestão, com a contagem dos alertas do seu escopo."""
    if not alertas:
        return
    for u in Usuario.objects.filter(is_active=True):
        if not u.tem_permissao(Permissao.ALERTAS_LER):
            continue
        no_escopo = [a for a in alertas if alerta_no_escopo(a, u)]
        n = len(no_escopo)
        if n == 0:
            continue
        _agendar(
            [u],
            TipoNotificacao.ALERTA_NOVO,
            "1 novo alerta ambiental" if n == 1 else f"{n} novos alertas ambientais",
            "",
            f"/alertas/{no_escopo[0].pk}" if n == 1 else "/alertas",
        )
