"""Contagem de ocorrências por tipo e situação, no escopo de quem consulta."""

from django.db.models import Count

from itree.contas.acesso import filtrar_por_escopo

from .models import EstadoOcorrencia, Ocorrencia


def contar_por_estado(usuario, tipo=None) -> dict:
    """``{tipo_id: {estado: quantidade}}``, com todas as situações (zero quando não há)."""
    qs = filtrar_por_escopo(Ocorrencia.objects.all(), usuario)
    if tipo is not None:
        qs = qs.filter(tipo=tipo)
    resultado: dict = {}
    for linha in qs.order_by().values("tipo_id", "estado").annotate(n=Count("id")):
        por_estado = resultado.setdefault(linha["tipo_id"], {e.value: 0 for e in EstadoOcorrencia})
        por_estado[linha["estado"]] = linha["n"]
    return resultado
