"""Do lote ao inventário: regra de junção (decisões de 21/11/2026).

Um grupo (detecções do mesmo rastreamento no lote) vira **uma** árvore:

- se há árvore ativa a até ``max(2 m, incerteza)`` (configurável), o grupo se **junta** a ela: a
  árvore ganha observações, fotos e medidas como estimadas, e ``ultima_vez_vista_em`` avança; dado
  confirmado por pessoa (espécie confirmada, medida medida ou importada) nunca é sobrescrito;
- se não há, **cria** a árvore, com origem ``deteccao_satelite`` ou ``deteccao_video``, ainda não
  confirmada e com a confiança da detecção;
- ``berco_vazio`` e ``toco`` não viram árvore: viram pontos de plantio possível.
"""

import statistics
from dataclasses import dataclass, field
from datetime import datetime, time

from django.conf import settings
from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point
from django.contrib.gis.measure import D
from django.utils import timezone

from itree.inventario.importacao import CatalogoEspecies
from itree.inventario.models import (
    UNIDADES_POR_TIPO,
    Arvore,
    EstadoEspecie,
    Medida,
    MetodoMedida,
    OrigemLocalizacao,
    OrigemRegistro,
    OrigemValor,
    SituacaoArvore,
    TipoMedida,
)

from .confianca import faixa_de_confianca  # noqa: F401 - reexportada
from .models import (
    LoteDeteccao,
    Observacao,
    PontoPlantio,
    ResultadoObservacao,
    Sensor,
    SinalRemocao,
    SituacaoPontoPlantio,
    SituacaoSinal,
)

TIPO_DA_MEDIDA = {
    "altura": TipoMedida.ALTURA,
    "diametro_copa": TipoMedida.DIAMETRO_COPA,
    "dap": TipoMedida.DAP,
}
ORIGEM_POR_SENSOR = {
    Sensor.SATELITE: OrigemRegistro.DETECCAO_SATELITE,
    Sensor.VIDEO_RUA: OrigemRegistro.DETECCAO_VIDEO,
}


def raio_de_juncao(incerteza_m: float) -> float:
    """``max(mínimo, incerteza)``, limitado ao teto configurado."""
    return min(
        max(settings.DETECCAO_RAIO_JUNCAO_MINIMO_M, incerteza_m),
        settings.DETECCAO_RAIO_JUNCAO_MAXIMO_M,
    )


@dataclass
class Agregado:
    """O que um grupo de detecções diz sobre a árvore."""

    ponto: Point
    incerteza_m: float
    confianca: float
    tipo: str
    especies: list[dict]
    medidas: dict
    contexto: str
    deteccoes: list[dict] = field(default_factory=list)


def agregar(grupo: list[dict]) -> Agregado:
    """Posição pela média ponderada pelo inverso da variância (incerteza²); incerteza combinada;
    confiança máxima; espécies pela probabilidade média; medidas pela mediana."""
    pesos = [1 / d["incerteza_m"] ** 2 for d in grupo]
    soma = sum(pesos)
    lon = sum(d["longitude"] * w for d, w in zip(grupo, pesos, strict=True)) / soma
    lat = sum(d["latitude"] * w for d, w in zip(grupo, pesos, strict=True)) / soma
    probabilidades: dict[str, list[float]] = {}
    for d in grupo:
        for c in d["especies"]:
            probabilidades.setdefault(c["nome_cientifico"], []).append(c["probabilidade"] or 0.0)
    especies = sorted(
        (
            {"nome_cientifico": nome, "probabilidade": round(sum(p) / len(grupo), 3)}
            for nome, p in probabilidades.items()
        ),
        key=lambda c: -c["probabilidade"],
    )[:3]
    medidas = {}
    for tipo in TIPO_DA_MEDIDA:
        itens = [d["medidas"][tipo] for d in grupo if tipo in d["medidas"]]
        if itens:
            incertezas = [i["incerteza"] for i in itens if i["incerteza"] is not None]
            medidas[tipo] = {
                "valor": round(statistics.median(i["valor"] for i in itens), 2),
                "unidade": itens[0]["unidade"],
                "incerteza": max(incertezas) if incertezas else None,
            }
    contextos = [d["contexto"] for d in grupo if d["contexto"]]
    return Agregado(
        ponto=Point(lon, lat, srid=4326),
        incerteza_m=soma**-0.5,
        confianca=max(d["confianca"] for d in grupo),
        tipo=grupo[0]["tipo"],
        especies=especies,
        medidas=medidas,
        contexto=max(set(contextos), key=contextos.count) if contextos else "",
        deteccoes=grupo,
    )


def _com_distancia(qs, ponto: Point, raio_m: float):
    """Árvores/pontos a até ``raio_m`` metros (distância em geografia), da mais próxima à mais
    distante. O pré-filtro por caixa usa o índice espacial."""
    grau = raio_m / 100_000 + 1e-6  # 1 grau >= ~110 km: a caixa nunca é menor que o raio
    return (
        qs.filter(geom__dwithin=(ponto, grau))
        .annotate(distancia_m=Distance("geom", ponto))
        .filter(distancia_m__lte=D(m=raio_m))
        .order_by("distancia_m", "pk")
    )


def arvore_proxima(ponto: Point, incerteza_m: float) -> Arvore | None:
    base = Arvore.objects.filter(situacao=SituacaoArvore.ATIVA, geom__isnull=False)
    return _com_distancia(base, ponto, raio_de_juncao(incerteza_m)).first()


def _instante(lote: LoteDeteccao) -> datetime:
    return timezone.make_aware(datetime.combine(lote.capturado_em, time(12, 0)))


def _valores(agregado: Agregado, lote: LoteDeteccao, d: dict) -> dict:
    return {
        "versao_modelo": lote.versao_modelo,
        "especies": d["especies"],
        "medidas": d["medidas"],
        "copa": d["copa"],
        "area_copa_m2": d["area_copa_m2"],
        "contexto": d["contexto"],
        "interferencias": d["interferencias"],
        "sinais": d["sinais"],
        "qualidade_imagem": d["qualidade_imagem"],
        "quadros_do_rastreamento": len(agregado.deteccoes),
    }


def _gravar_observacoes(arvore: Arvore, lote: LoteDeteccao, agregado: Agregado, resultado: str):
    criadas = []
    for d in agregado.deteccoes:
        criadas.append(
            Observacao.objects.create(
                arvore=arvore,
                lote=lote,
                id_deteccao=d["id"],
                id_rastreamento=d["rastreamento"],
                sensor=lote.sensor,
                resultado=resultado,
                confianca=d["confianca"],
                capturada_em=lote.capturado_em,
                geom=Point(d["longitude"], d["latitude"], srid=4326),
                incerteza_m=d["incerteza_m"],
                valores=_valores(agregado, lote, d),
            )
        )
    return criadas


def _especie_sugerida(agregado: Agregado, catalogo: CatalogoEspecies):
    """(espécie do catálogo, texto original) da candidata mais provável."""
    if not agregado.especies:
        return None, ""
    nome = agregado.especies[0]["nome_cientifico"]
    especie, _, _ = catalogo.resolver(nome)
    return especie, nome


def _gravar_medidas(arvore: Arvore, agregado: Agregado, lote: LoteDeteccao) -> None:
    """Medidas estimadas por imagem. Se já existe medida aplicada de pessoa (medida ou
    importada) do mesmo tipo, a estimativa fica guardada, mas **não aplicada**: não sobrescreve."""
    for chave, m in agregado.medidas.items():
        tipo = TIPO_DA_MEDIDA[chave]
        humana = arvore.medidas.filter(
            tipo=tipo, aplicada=True, origem__in=[OrigemValor.MEDIDO, OrigemValor.IMPORTADO]
        ).exists()
        incerteza = f" (incerteza de {m['incerteza']} {m['unidade']})" if m["incerteza"] else ""
        Medida.objects.create(
            arvore=arvore,
            tipo=tipo,
            valor=m["valor"],
            unidade=UNIDADES_POR_TIPO[tipo],
            metodo=MetodoMedida.IMAGEM,
            origem=OrigemValor.ESTIMADO,
            data_medicao=lote.capturado_em,
            aplicada=not humana,
            responsavel_texto=f"Detecção automática ({lote.projeto_origem} {lote.versao_modelo})",
            observacao=f"Estimativa por imagem ({lote.get_sensor_display().lower()}){incerteza}.",
        )


def criar_arvore(
    agregado: Agregado, lote: LoteDeteccao, catalogo: CatalogoEspecies, resolvedor
) -> Arvore:
    especie, texto = _especie_sugerida(agregado, catalogo)
    arvore = Arvore(
        especie=especie,
        especie_estado=EstadoEspecie.SUGERIDA_IA if especie else EstadoEspecie.NAO_IDENTIFICADA,
        especie_texto_original="" if especie else texto,
        geom=agregado.ponto,
        localizacao_origem=OrigemLocalizacao.DETECTADA,
        precisao_m=round(agregado.incerteza_m, 2),
        origem_registro=ORIGEM_POR_SENSOR[lote.sensor],
        criado_por=lote.enviado_por,
        confirmada=False,
        confianca=agregado.confianca,
        ultima_vez_vista_em=_instante(lote),
        observacoes=f"Detectada automaticamente ({lote.projeto_origem} {lote.versao_modelo}).",
    )
    arvore.bairro_id = resolvedor.id_do_ponto(agregado.ponto)
    arvore._bairro_pronto = True  # noqa: SLF001 - bairro já resolvido em memória
    arvore.save()
    return arvore


def juntar_a_arvore(arvore: Arvore, agregado: Agregado, lote: LoteDeteccao, catalogo) -> None:
    """Atualiza a árvore existente sem sobrescrever o que uma pessoa confirmou."""
    campos = {"atualizado_em"}
    instante = _instante(lote)
    if arvore.ultima_vez_vista_em is None or instante > arvore.ultima_vez_vista_em:
        arvore.ultima_vez_vista_em = instante
        campos.add("ultima_vez_vista_em")
    if not arvore.confirmada and (
        arvore.confianca is None or agregado.confianca > arvore.confianca
    ):
        arvore.confianca = agregado.confianca
        campos.add("confianca")
    if arvore.especie_estado == EstadoEspecie.NAO_IDENTIFICADA and agregado.especies:
        especie, texto = _especie_sugerida(agregado, catalogo)
        if especie is not None:
            arvore.especie = especie
            arvore.especie_estado = EstadoEspecie.SUGERIDA_IA
            campos |= {"especie", "especie_estado"}
        elif not arvore.especie_texto_original:
            arvore.especie_texto_original = texto
            campos.add("especie_texto_original")
    arvore.save(update_fields=sorted(campos))
    _gravar_medidas(arvore, agregado, lote)
    # Árvore vista de novo: o sinal de possível remoção pendente deixa de fazer sentido.
    SinalRemocao.objects.filter(arvore=arvore, situacao=SituacaoSinal.PENDENTE).exclude(
        lote=lote
    ).update(
        situacao=SituacaoSinal.DESCARTADO,
        decidido_em=timezone.now(),
        motivo=f"Árvore vista de novo no lote {lote.id_externo}.",
    )


def tratar_arvore(agregado, lote, catalogo, resolvedor) -> tuple[Arvore, str]:
    """Cria ou junta. Devolve a árvore e o resultado (``criou`` ou ``juntou``)."""
    existente = arvore_proxima(agregado.ponto, agregado.incerteza_m)
    if existente is not None:
        juntar_a_arvore(existente, agregado, lote, catalogo)
        _gravar_observacoes(existente, lote, agregado, ResultadoObservacao.JUNTOU)
        return existente, ResultadoObservacao.JUNTOU
    arvore = criar_arvore(agregado, lote, catalogo, resolvedor)
    _gravar_medidas(arvore, agregado, lote)
    _gravar_observacoes(arvore, lote, agregado, ResultadoObservacao.CRIOU)
    return arvore, ResultadoObservacao.CRIOU


def tratar_ponto_plantio(agregado: Agregado, lote: LoteDeteccao, resolvedor) -> bool:
    """Cria o ponto de plantio possível. Devolve ``False`` se já havia um aberto, do mesmo tipo,
    no mesmo lugar (então só renova a "última vez visto")."""
    proximo = _com_distancia(
        PontoPlantio.objects.filter(situacao=SituacaoPontoPlantio.ABERTO, tipo=agregado.tipo),
        agregado.ponto,
        raio_de_juncao(agregado.incerteza_m),
    ).first()
    if proximo is not None:
        proximo.ultima_vez_visto_em = max(proximo.ultima_vez_visto_em, lote.capturado_em)
        proximo.save(update_fields=["ultima_vez_visto_em", "atualizado_em"])
        return False
    primeira = agregado.deteccoes[0]
    PontoPlantio.objects.create(
        lote=lote,
        id_deteccao=primeira["id"],
        tipo=agregado.tipo,
        geom=agregado.ponto,
        incerteza_m=round(agregado.incerteza_m, 2),
        confianca=agregado.confianca,
        contexto=agregado.contexto,
        capturado_em=lote.capturado_em,
        ultima_vez_visto_em=lote.capturado_em,
        bairro_id=resolvedor.id_do_ponto(agregado.ponto),
    )
    return True
