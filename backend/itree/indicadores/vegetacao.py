"""Cobertura vegetal por bairro pelo NDVI de 10 m (UrbVerde, IAU-USP): o "30" da regra 3-30-300.

É **cobertura de vegetação, não só de copa de árvore**: o NDVI (índice de vegetação por diferença
normalizada, de imagem Sentinel-2) não separa árvore de gramado, mato ou cultivo. Quando houver
copas detectadas (detecção automática), a cobertura de copa passa a ser a medida principal do "30"
(``regra_3_30_300.parte_30``) e este indicador fica como referência.

Cada pixel de 10 m com NDVI maior ou igual ao limiar (``VEGETACAO_LIMIAR_NDVI``, padrão 0,4) conta
como vegetação. O valor do bairro é pixels com vegetação ÷ pixels medidos cujo centro cai no
bairro, pelo mesmo método da ilha de calor (``ilha_calor.medir``). A cobertura do raster e o limiar
ficam gravados no indicador.

**Fonte e licença.** Camada ``NDVI-10m-<ano>`` do GeoServer da UrbVerde (WCS ``urbverde__NDVI-10m-
2021``). Termos de Uso da UrbVerde: uso acadêmico, educacional, público e de pesquisa, vedado o uso
comercial sem autorização prévia por escrito; citar a Plataforma UrbVerde (USP). Sem licença aberta.
Como a ilha de calor, o valor só é gravado com ``URBVERDE_GRAVAR_VALORES`` ligado.

**Disponibilidade (verificada em 21/11/2026).** As camadas NDVI do GeoServer da UrbVerde não cobrem
Fortaleza: a de 2021 anuncia a caixa -53,1/-25,4 a -44,2/-19,8 (Sudeste) e a de 2016, 0 a 4,6 N
(Norte); os mosaicos ``ndvi_mosaico_*`` não existem (``LayerNotDefined``) e a leitura dos arquivos
falha no servidor (``Failed to create reader``). Por isso o comando aceita um GeoTIFF local
(``--arquivo``), de qualquer fonte aberta de NDVI de 10 m (por exemplo, composição Sentinel-2),
e a coleta pelo WCS fica configurável (``VEGETACAO_COBERTURA_WCS``) para quando a UrbVerde publicar.
"""

from datetime import date

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from itree.territorio.models import Territorio, TipoTerritorio

from . import ilha_calor
from .models import IndicadorTerritorialExterno

INDICADOR = "cobertura_vegetal_ndvi"
NOME = "Cobertura vegetal por NDVI de 10 m (UrbVerde, 2021)"
ANO = 2021
DATA_REFERENCIA = date(ANO, 12, 31)
COBERTURA_PADRAO = "urbverde__NDVI-10m-2021"
LIMIAR_PADRAO = 0.4
URL_FONTE = "https://urbverde.iau.usp.br/"
FONTE = "UrbVerde (IAU-USP): NDVI de 10 m, 2021"
LICENCA = ilha_calor.LICENCA
DEFINICAO = (
    "Percentual da área do bairro com vegetação, medido pelo NDVI de 10 m de 2021: pixels com NDVI "
    "maior ou igual ao limiar (padrão 0,4) sobre os pixels com medição do bairro. É cobertura "
    "vegetal, não só de copa de árvore: o NDVI não separa árvore de gramado, mato ou cultivo."
)
METODO = (
    "Raster NDVI de 10 m (UrbVerde, 2021), pixel a pixel. O valor do bairro é a razão entre os "
    "pixels medidos com NDVI ≥ limiar e os pixels medidos cujo centro cai dentro do polígono do "
    "bairro (limites do Ipplan); pixel sem medição não entra. Numerador = pixels com vegetação; "
    "denominador = pixels medidos. A referência de Fortaleza é a soma dos pixels, não a média dos "
    "bairros."
)


def limiar() -> float:
    return float(getattr(settings, "VEGETACAO_LIMIAR_NDVI", LIMIAR_PADRAO))


def ndvi_valido(v: float) -> bool:
    return v == v and -1.0 <= v <= 1.0


def calcular(grade: ilha_calor.Grade, limiar_ndvi: float | None = None) -> ilha_calor.Resultado:
    """Mede cada bairro: ``Medida.acima`` = pixels com vegetação, ``validos`` = pixels medidos."""
    corte = limiar() if limiar_ndvi is None else limiar_ndvi
    resultado = ilha_calor.Resultado()
    pixels = vegetacao = 0
    for bairro in Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO).only("id", "nome", "geom"):
        medida = ilha_calor.medir(bairro.geom, grade, valido=ndvi_valido, limiar=corte)
        resultado.nomes[str(bairro.pk)] = bairro.nome
        if medida.validos:
            resultado.medidas[str(bairro.pk)] = medida
            pixels += medida.validos
            vegetacao += medida.acima
        else:
            resultado.sem_medicao.append(bairro.nome)
    resultado.media_cidade = 100 * vegetacao / pixels if pixels else None
    return resultado


def gravar(
    resultado: ilha_calor.Resultado, limiar_ndvi: float, *, fonte_url=URL_FONTE, ingerido_em=None
):
    agora = ingerido_em or timezone.now()
    with transaction.atomic():
        for id_, medida in resultado.medidas.items():
            IndicadorTerritorialExterno.objects.update_or_create(
                territorio_id=id_,
                indicador=INDICADOR,
                defaults={
                    "valor": round(100 * medida.acima / medida.validos, 2),
                    "numerador": medida.acima,
                    "denominador": medida.validos,
                    "unidade": "%",
                    "fonte": FONTE,
                    "fonte_url": fonte_url,
                    "licenca": LICENCA,
                    "data_referencia": DATA_REFERENCIA,
                    "ingerido_em": agora,
                    "definicao": DEFINICAO,
                    "metodo": METODO,
                    "versao": f"limiar NDVI {limiar_ndvi:g}".replace(".", ","),
                },
            )
        IndicadorTerritorialExterno.objects.filter(indicador=INDICADOR).exclude(
            territorio_id__in=list(resultado.medidas)
        ).delete()
    resultado.gravados = len(resultado.medidas)
    return resultado.gravados


def importar(
    conteudo: bytes, *, limiar_ndvi: float | None = None, fonte_url=URL_FONTE, ingerido_em=None
) -> ilha_calor.Resultado:
    """Calcula a cobertura vegetal por bairro e, com ``URBVERDE_GRAVAR_VALORES`` ligado, grava."""
    corte = limiar() if limiar_ndvi is None else limiar_ndvi
    resultado = calcular(ilha_calor.ler_grade(conteudo), corte)
    if ilha_calor.gravar_permitido():
        gravar(resultado, corte, fonte_url=fonte_url, ingerido_em=ingerido_em)
    return resultado


def baixar(caixa=None) -> bytes:
    """Recorte do raster NDVI pelo WCS da UrbVerde (``VEGETACAO_COBERTURA_WCS``)."""
    caixa = caixa or ilha_calor.caixa_dos_bairros()
    if caixa is None:
        raise ilha_calor.RasterInvalido("Sem bairros cadastrados.")
    cobertura = getattr(settings, "VEGETACAO_COBERTURA_WCS", COBERTURA_PADRAO)
    return ilha_calor.baixar(caixa, cobertura=cobertura)
