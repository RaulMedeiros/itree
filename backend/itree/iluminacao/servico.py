"""Consultas sobre a iluminação pública usadas por outras partes do sistema."""

from .models import LoteIluminacao, PontoIluminacao


def resumo_da_iluminacao() -> dict | None:
    """Fonte, licença e data da última importação; ``None`` se nunca houve uma."""
    lote = LoteIluminacao.objects.order_by("-ingerido_em").first()
    if lote is None:
        return None
    return {
        "quantidade": PontoIluminacao.objects.count(),
        "fonte": lote.fonte,
        "fonte_url": lote.fonte_url,
        "licenca": lote.licenca,
        "data_referencia": lote.data_referencia,
        "ingerido_em": lote.ingerido_em,
    }
