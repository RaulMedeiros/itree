"""Formato brasileiro dos números no detalhe da análise "árvores por 1.000 habitantes"."""

from itree.indicadores.populacao_indicadores import _br


def test_numero_no_formato_brasileiro():
    assert _br(192.5, 1) == "192,5"
    assert _br(1234.56, 1) == "1.234,6"
    assert _br(12511) == "12.511"
