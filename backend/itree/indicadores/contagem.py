"""Contagem de árvores nos indicadores: **todas** ou **só as confirmadas** (decisão de 21/11/2026).

A detecção automática entra direto no inventário, mas só a inspeção de campo ou a revisão humana
a "confirma". Por isso, onde há contagem de árvores, o iTree mostra "N árvores (M confirmadas)" e
oferece o filtro ``contagem=todas|confirmadas`` (padrão ``todas``), que também vai na URL da tela.

Como usar em um indicador novo (por exemplo, a regra 3-30-300):

1. leia o parâmetro com ``do_pedido(request)`` (ou ``validar(valor)``) e declare-o no OpenAPI com
   ``PARAMETRO``;
2. restrinja o queryset de árvores com ``filtrar(arvores, contagem)``;
3. para mostrar as duas contagens **sem consultar duas vezes**, use ``totais(qs)`` (uma consulta
   com agregação condicional) ou ``por_grupo(qs, "bairro_id")`` (uma consulta para todos os
   grupos); ambos devolvem ``(total, confirmadas)``;
4. o número que alimenta o indicador é ``escolher(total, confirmadas, contagem)``.
"""

from django.db.models import Count, Q, QuerySet
from drf_spectacular.utils import OpenApiParameter
from rest_framework.exceptions import ValidationError
from rest_framework.request import Request

TODAS = "todas"
CONFIRMADAS = "confirmadas"
OPCOES = (TODAS, CONFIRMADAS)

PARAMETRO = OpenApiParameter(
    "contagem",
    str,
    enum=list(OPCOES),
    description="Quais árvores entram nas contagens: `todas` (padrão, inclui as detectadas "
    "automaticamente e ainda sem revisão) ou `confirmadas` (só as confirmadas por inspeção ou "
    "revisão humana). A resposta traz as duas contagens quando se aplica.",
)

ROTULOS = {TODAS: "todas as árvores", CONFIRMADAS: "só as confirmadas"}


def validar(valor: str | None) -> str:
    """``todas`` (padrão) ou ``confirmadas``; outro valor é erro de validação (400)."""
    if valor in (None, ""):
        return TODAS
    if valor not in OPCOES:
        raise ValidationError({"contagem": [f"Use {' ou '.join(OPCOES)}."]})
    return valor


def do_pedido(request: Request) -> str:
    return validar(request.query_params.get("contagem"))


def filtrar(arvores: QuerySet, contagem: str) -> QuerySet:
    """Com ``confirmadas``, só as árvores confirmadas; com ``todas``, o queryset como está."""
    return arvores.filter(confirmada=True) if contagem == CONFIRMADAS else arvores


def escolher(total: int, confirmadas: int, contagem: str) -> int:
    return confirmadas if contagem == CONFIRMADAS else total


def totais(arvores: QuerySet) -> tuple[int, int]:
    """(total, confirmadas) numa só consulta."""
    r = arvores.order_by().aggregate(
        total=Count("pk"), confirmadas=Count("pk", filter=Q(confirmada=True))
    )
    return r["total"], r["confirmadas"]


def por_grupo(arvores: QuerySet, campo: str) -> dict:
    """{valor do campo: (total, confirmadas)} numa só consulta, para todos os grupos."""
    linhas = (
        arvores.order_by()
        .values_list(campo)
        .annotate(total=Count("pk"), confirmadas=Count("pk", filter=Q(confirmada=True)))
    )
    return {chave: (total, conf) for chave, total, conf in linhas}


def rotulo(total: int, confirmadas: int) -> str:
    """Texto padrão: ``"1.234 árvores (567 confirmadas)"`` (no singular com 1)."""
    arvores = "árvore" if total == 1 else "árvores"
    conf = "confirmada" if confirmadas == 1 else "confirmadas"
    return f"{_br(total)} {arvores} ({_br(confirmadas)} {conf})"


def _br(valor: int) -> str:
    return f"{valor:,}".replace(",", ".")
