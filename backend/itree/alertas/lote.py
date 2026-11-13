"""Ações em lote sobre alertas (M-26): mudança de status pelas transições permitidas."""

from itree.core.lote import Preparo, RegistroIgnorado, acao_em_lote

from .escopo import filtrar_alertas_por_escopo
from .models import FINAIS_ALERTA, TRANSICOES_ALERTA, AlertaAmbiental, StatusAlerta
from .views import filtrar_alertas


@acao_em_lote("alertas", "status")
def status(usuario, parametros: dict) -> Preparo:
    novo = parametros["status"]
    justificativa, referencia = parametros["justificativa"], parametros["referencia"]

    def alterar(alerta: AlertaAmbiental) -> None:
        if novo not in TRANSICOES_ALERTA.get(alerta.status, set()):
            raise RegistroIgnorado(
                f"Não pode passar de “{StatusAlerta(alerta.status).label}” "
                f"para “{StatusAlerta(novo).label}”."
            )
        alerta.status = novo
        alerta.justificativa = justificativa
        if referencia:
            alerta.referencia = referencia
        alerta.analisado_por = usuario
        alerta.save(
            update_fields=[
                "status",
                "justificativa",
                "referencia",
                "analisado_por",
                "atualizado_em",
            ]
        )

    return Preparo(
        consulta=lambda: filtrar_alertas_por_escopo(
            AlertaAmbiental.objects.select_related("analisado_por", "ocorrencia"), usuario
        ),
        filtrar=lambda qs, filtros: filtrar_alertas(qs, filtros),
        finais=FINAIS_ALERTA,
        alterar=alterar,
        evento="alertas_status_em_lote",
        campo_estado="status",
    )
