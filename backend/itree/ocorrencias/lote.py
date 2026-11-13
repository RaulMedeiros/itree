"""Ações em lote sobre ocorrências (G-07, M-23, M-26): o que cada ação altera."""

from datetime import date

from django.utils import timezone

from itree.contas.models import Equipe, Usuario
from itree.contas.permissoes import Permissao as P
from itree.core.lote import Preparo, acao_em_lote

from .models import ESTADOS_FINAIS, Ocorrencia
from .views import filtrar_ocorrencias, ocorrencias_do_escopo


def _preparo(usuario, evento: str, alterar, permissao: str = P.OCORRENCIAS_EDITAR) -> Preparo:
    return Preparo(
        consulta=lambda: ocorrencias_do_escopo(usuario),
        filtrar=lambda qs, filtros: filtrar_ocorrencias(qs, filtros),
        finais=ESTADOS_FINAIS,
        alterar=alterar,
        evento=evento,
        permissao=permissao,
    )


@acao_em_lote("ocorrencias", "reatribuir")
def reatribuir(usuario, parametros: dict) -> Preparo:
    campos = []
    if "responsavel_id" in parametros:
        pk = parametros["responsavel_id"]
        campos.append(("responsavel", Usuario.objects.get(pk=pk) if pk else None))
    if "equipe_id" in parametros:
        pk = parametros["equipe_id"]
        campos.append(("equipe", Equipe.objects.get(pk=pk) if pk else None))

    def alterar(ocorrencia: Ocorrencia) -> None:
        for campo, valor in campos:
            setattr(ocorrencia, campo, valor)
        ocorrencia.save(update_fields=[*(c for c, _ in campos), "atualizado_em"])

    return _preparo(usuario, "ocorrencias_reatribuidas_em_lote", alterar)


@acao_em_lote("ocorrencias", "prioridade")
def prioridade(usuario, parametros: dict) -> Preparo:
    agora = timezone.now()

    def alterar(ocorrencia: Ocorrencia) -> None:
        ocorrencia.prioridade = parametros["prioridade"]
        ocorrencia.prioridade_definida_por = usuario
        ocorrencia.prioridade_definida_em = agora
        ocorrencia.save(
            update_fields=[
                "prioridade",
                "prioridade_definida_por",
                "prioridade_definida_em",
                "atualizado_em",
            ]
        )

    return _preparo(usuario, "prioridade_definida_em_lote", alterar, P.OCORRENCIAS_PRIORIZAR)


@acao_em_lote("ocorrencias", "prazo")
def prazo(usuario, parametros: dict) -> Preparo:
    novo = date.fromisoformat(parametros["prazo"]) if parametros["prazo"] else None

    def alterar(ocorrencia: Ocorrencia) -> None:
        ocorrencia.prazo = novo
        ocorrencia.save(update_fields=["prazo", "atualizado_em"])

    return _preparo(usuario, "prazo_definido_em_lote", alterar)
