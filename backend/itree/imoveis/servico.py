"""Resumo das camadas de imóveis e uso do solo (fonte, licença, volume e data), para o painel de
camadas do mapa e a atribuição na tela."""

from django.db.models import Count, Max

from . import macrozoneamento
from .models import Edificacao, LoteEdificacoes, LoteUsoSolo, Macrozona


def resumo_dos_imoveis() -> dict:
    lote = LoteEdificacoes.objects.order_by("-ingerido_em").first()
    edificacoes = None
    if lote is not None:
        total = Edificacao.objects.count()
        classificadas = Edificacao.objects.exclude(uso="").count()
        edificacoes = {
            "fonte": lote.fonte_texto,
            "fonte_url": lote.fonte_url,
            "licenca": lote.licenca,
            "data_referencia": lote.data_referencia,
            "ingerido_em": lote.ingerido_em,
            "quantidade": total,
            "classificadas_por_uso": classificadas,
            "cobertura_uso": round(classificadas / total, 4) if total else None,
        }
    lotes = LoteUsoSolo.objects.aggregate(n=Count("id"), ingerido=Max("ingerido_em"))
    uso_lote = (
        {
            "fonte": "SEFIN, uso predominante por lote, 2022 (Fortaleza em Mapas)",
            "licenca": "Termos da API do Fortaleza em Mapas: uso livre, com citação da fonte",
            "quantidade": lotes["n"],
            "ingerido_em": lotes["ingerido"],
        }
        if lotes["n"]
        else None
    )
    zonas = Macrozona.objects.aggregate(n=Count("id"), ingerido=Max("ingerido_em"))
    zonas_resumo = (
        {
            "fonte": macrozoneamento.FONTE,
            "fonte_url": macrozoneamento.URL_PAGINA,
            "licenca": macrozoneamento.LICENCA,
            "data_referencia": macrozoneamento.DATA_REFERENCIA,
            "quantidade": zonas["n"],
            "ingerido_em": zonas["ingerido"],
        }
        if zonas["n"]
        else None
    )
    return {"edificacoes": edificacoes, "uso_lote": uso_lote, "macrozoneamento": zonas_resumo}
