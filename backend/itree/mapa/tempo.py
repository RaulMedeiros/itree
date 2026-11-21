"""Linha do tempo do mapa: o que existia (ou aconteceu) num mês ou num intervalo de meses.

O período vem de ``ate=AAAA-MM`` (situação ao fim desse mês) e, no modo intervalo, de
``desde=AAAA-MM`` (do começo desse mês ao fim de ``ate``). Sem ``ate``, o mapa mostra o presente e
nada aqui é usado.

Definições (iguais nos tiles, nas contagens e no histograma):

* **Árvore na data**: cadastrada antes do fim do período (``criado_em``, a data do cadastro no
  iTree, **não** a do plantio) e ainda não removida nele. A remoção é a primeira vez em que o
  histórico (pghistory) registra a árvore fora da situação ``ativa``. No intervalo, só as
  cadastradas a partir de ``desde``.
* **Condição na data**: a da última inspeção validada, com a condição aplicada ao cadastro, até o
  fim do período. Sem ela, "não avaliada".
* **Ocorrência aberta na data**: registrada antes do fim do período e ainda não concluída nem
  cancelada nele. No intervalo, também as que ficaram abertas em algum momento dele.
* **Alertas e focos**: os detectados dentro do período (mês, ou intervalo).
"""

import re
from dataclasses import dataclass
from datetime import datetime

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from itree.ocorrencias.models import ESTADOS_FINAIS

_MES = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


@dataclass(frozen=True)
class Periodo:
    inicio: datetime | None  # começo do intervalo; None = situação num instante (fim do mês)
    fim: datetime  # exclusivo: primeiro instante do mês seguinte a ``ate``

    @property
    def inicio_dos_alertas(self) -> datetime:
        """Alertas e focos: o mês escolhido, ou do começo do intervalo em diante."""
        return self.inicio or _primeiro_do_mes(self.fim, -1)

    def parametros(self) -> dict:
        valores = {"t_fim": self.fim, "finais": FINAIS}
        if self.inicio is not None:
            valores["t_inicio"] = self.inicio
        return valores


def _primeiro_do_mes(referencia: datetime, deslocamento: int = 0) -> datetime:
    indice = referencia.year * 12 + referencia.month - 1 + deslocamento
    ano, mes = divmod(indice, 12)
    return timezone.make_aware(datetime(ano, mes + 1, 1))


def _mes(valor: str, nome: str) -> datetime:
    m = _MES.match(valor.strip())
    if not m:
        raise ValidationError({nome: "Use o formato AAAA-MM."})
    return timezone.make_aware(datetime(int(m.group(1)), int(m.group(2)), 1))


def periodo_da_requisicao(params) -> Periodo | None:
    """Lê ``ate`` e ``desde``; ``None`` quando o mapa está no presente."""
    ate = params.get("ate")
    if not ate:
        return None
    fim = _primeiro_do_mes(_mes(ate, "ate"), 1)
    inicio = None
    if desde := params.get("desde"):
        inicio = _mes(desde, "desde")
        if inicio >= fim:
            raise ValidationError({"desde": "O começo do intervalo é depois do fim."})
    return Periodo(inicio=inicio, fim=fim)


# --- Árvores ----------------------------------------------------------------------------------
# Remoção: primeira vez que o histórico a mostra fora de "ativa". Só é consultada para árvores que
# hoje não estão ativas (a primeira alternativa do OR dispensa a subconsulta nas ativas).
_REMOVIDA_EM = (
    "(SELECT min(e.pgh_created_at) FROM inventario_arvoreevent e"
    " WHERE e.pgh_obj_id = {a}.id AND e.situacao <> 'ativa')"
)

# Condição na data: última inspeção validada que aplicou a condição ao cadastro, até o fim do
# período. Índice parcial em (arvore_id, realizada_em DESC).
JUNCAO_CONDICAO = """
    LEFT JOIN LATERAL (
        SELECT i.condicao_aparente
          FROM inspecoes_inspecao i
         WHERE i.arvore_id = {a}.id AND i.estado = 'validada'
           AND 'condicao_aparente' = ANY(i.aplicado_ao_cadastro)
           AND i.realizada_em < %(t_fim)s
         ORDER BY i.realizada_em DESC
         LIMIT 1
    ) c ON true
"""
EXPRESSAO_CONDICAO = "COALESCE(NULLIF(c.condicao_aparente, ''), 'nao_avaliada')"
# Dias sem inspeção são contados até o fim do período, com a inspeção validada mais recente até lá.
ULTIMA_INSPECAO = (
    "(SELECT max(i.realizada_em) FROM inspecoes_inspecao i"
    " WHERE i.arvore_id = {a}.id AND i.estado = 'validada' AND i.realizada_em < %(t_fim)s)"
)


def arvore_na_data(periodo: Periodo, a: str = "a") -> str:
    """Condição SQL: a árvore ``a`` existia (cadastrada e não removida) no período."""
    clausulas = [
        f"{a}.criado_em < %(t_fim)s",
        f"({a}.situacao = 'ativa' OR {_REMOVIDA_EM.format(a=a)} >= %(t_fim)s)",
    ]
    if periodo.inicio is not None:
        clausulas.append(f"{a}.criado_em >= %(t_inicio)s")
    return " AND ".join(clausulas)


def juncao_condicao(a: str = "a") -> str:
    return JUNCAO_CONDICAO.format(a=a)


def ultima_inspecao(a: str = "a") -> str:
    return ULTIMA_INSPECAO.format(a=a)


# --- Ocorrências ------------------------------------------------------------------------------
# Fechamento: conclusão registrada; no cancelamento, a primeira vez que o histórico a mostra
# cancelada (o cancelamento não grava data própria).
_FECHADA_EM = (
    "CASE o.estado"
    " WHEN 'concluida' THEN COALESCE(o.concluida_em, o.atualizado_em)"
    " WHEN 'cancelada' THEN (SELECT min(e.pgh_created_at) FROM ocorrencias_ocorrenciaevent e"
    "  WHERE e.pgh_obj_id = o.id AND e.estado = 'cancelada')"
    " END"
)


def ocorrencia_aberta_na_data(periodo: Periodo) -> str:
    """Condição SQL: a ocorrência ``o`` estava aberta no instante (ou em algum momento do
    intervalo)."""
    referencia = "%(t_inicio)s" if periodo.inicio is not None else "%(t_fim)s"
    return (
        "o.criado_em < %(t_fim)s"
        f" AND (o.estado <> ALL(%(finais)s) OR {_FECHADA_EM} >= {referencia})"
    )


def ocorrencia_registrada_ate(periodo: Periodo) -> str:
    return "o.criado_em < %(t_fim)s"


FINAIS = [e.value for e in ESTADOS_FINAIS]
