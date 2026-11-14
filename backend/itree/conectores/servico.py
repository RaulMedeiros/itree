"""Sincronização dos conectores (RF-INT-006).

Camada de referência: as feições do conector são substituídas numa única transação, então o
mapa nunca mostra uma camada pela metade. Lote de importação: cria uma prévia e **para aí**;
quem confirma é uma pessoa, como em qualquer importação (DP-18 segue aberta).
"""

import hashlib
import json
import logging
import re
from datetime import timedelta

from django.conf import settings
from django.contrib.gis.geos import GEOSGeometry
from django.db import transaction
from django.utils import timezone

from itree.contas.acesso import area_do_escopo
from itree.inventario import importacao
from itree.inventario.models import EstadoLote, LoteImportacao

from . import clientes
from .models import (
    Conector,
    DestinoConector,
    ExecucaoConector,
    FeicaoReferencia,
    OrigemExecucao,
    Periodicidade,
)
from .seguranca import ErroConector

logger = logging.getLogger(__name__)

TIPOS_GEOMETRIA = {
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
}
# Uma execução sem fim há mais que isto foi interrompida (worker morto) e não bloqueia a próxima.
TEMPO_MAXIMO_EXECUCAO = timedelta(minutes=30)
# O agendador roda de hora em hora: a folga evita que a execução "escorregue" um dia.
FOLGA_AGENDADOR = timedelta(minutes=30)
NOMES_LATITUDE = ("latitude", "lat", "y")
NOMES_LONGITUDE = ("longitude", "lon", "lng", "long", "x")


class ExecucaoEmAndamento(Exception):
    pass


# ---------------------------------------------------------------------------------------------
# Leitura das feições (dado não confiável: só interpretar)
# ---------------------------------------------------------------------------------------------


def _decimal(valor) -> float | None:
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int | float):
        return float(valor)
    try:
        return float(str(valor).strip().replace(",", "."))
    except (TypeError, ValueError):
        return None


def _geometria(bruta) -> GEOSGeometry | None:
    """GeoJSON → geometria 2D em 4326, ou ``None`` se ausente, de tipo não aceito, fora do globo
    ou impossível de consertar. A coordenada Z (comum nas fontes municipais) é descartada."""
    if not isinstance(bruta, dict) or bruta.get("type") not in TIPOS_GEOMETRIA:
        return None
    try:
        geom = GEOSGeometry(json.dumps(bruta), srid=4326)
        if geom.hasz:
            ogr = geom.ogr
            ogr.set_3d(False)
            geom = ogr.geos
            geom.srid = 4326
        if geom.empty:
            return None
        if not geom.valid:
            geom = geom.make_valid()
            if geom.empty or geom.geom_type not in TIPOS_GEOMETRIA:
                return None
        oeste, sul, leste, norte = geom.extent
    except Exception:  # noqa: BLE001 - dado não confiável: qualquer falha de leitura é inválido
        return None
    if not (-180 <= oeste <= leste <= 180 and -90 <= sul <= norte <= 90):
        return None
    return geom


def _coluna(colunas: list[str], nomes: tuple[str, ...], escolhida: str | None) -> str | None:
    if escolhida:
        return escolhida if escolhida in colunas else None
    por_nome = {c.strip().lower(): c for c in colunas}
    return next((por_nome[n] for n in nomes if n in por_nome), None)


def _feicoes_do_csv(conteudo: bytes, parametros: dict) -> list[dict]:
    colunas, registros = importacao.ler_registros(conteudo, "csv")
    col_lat = _coluna(colunas, NOMES_LATITUDE, parametros.get("coluna_latitude"))
    col_lon = _coluna(colunas, NOMES_LONGITUDE, parametros.get("coluna_longitude"))
    if not col_lat or not col_lon:
        raise ErroConector(
            "O CSV não tem colunas de latitude e longitude. Informe-as nos parâmetros."
        )
    feicoes = []
    for registro in registros:
        lat, lon = _decimal(registro.get(col_lat)), _decimal(registro.get(col_lon))
        geometria = (
            {"type": "Point", "coordinates": [lon, lat]}
            if lat is not None and lon is not None
            else None
        )
        feicoes.append(
            {
                "type": "Feature",
                "geometry": geometria,
                "properties": {k: v for k, v in registro.items() if k not in (col_lat, col_lon)},
            }
        )
    return feicoes


def _id_externo(feicao: dict, propriedades: dict, geometria: dict, campo_id: str) -> str:
    if campo_id:
        valor = propriedades.get(campo_id)
        if valor not in (None, ""):
            return str(valor)[:200]
    elif feicao.get("id") not in (None, ""):
        return str(feicao["id"])[:200]
    base = json.dumps([geometria, propriedades], sort_keys=True, ensure_ascii=False)
    return "h-" + hashlib.sha256(base.encode()).hexdigest()[:32]


def ler_feicoes(baixado: clientes.Baixado, parametros: dict) -> tuple[list[dict], int, int]:
    """Devolve (feições válidas, recebidas, inválidas). Cada feição:
    ``{id_externo, geom, propriedades}``. Feição sem geometria aproveitável, ou com
    identificador repetido, conta como inválida."""
    if baixado.formato == "csv":
        brutas = _feicoes_do_csv(baixado.conteudo, parametros)
    else:
        brutas = json.loads(baixado.conteudo)["features"]
    if len(brutas) > settings.ITREE_CONECTORES_MAX_FEICOES:
        raise ErroConector(
            f"A fonte tem mais de {settings.ITREE_CONECTORES_MAX_FEICOES} feições, "
            "o limite de uma sincronização."
        )
    campo_id = str(parametros.get("campo_id") or "").strip()
    validas: dict[str, dict] = {}
    invalidas = 0
    for feicao in brutas:
        if not isinstance(feicao, dict):
            invalidas += 1
            continue
        propriedades = feicao.get("properties")
        propriedades = propriedades if isinstance(propriedades, dict) else {}
        geom = _geometria(feicao.get("geometry"))
        if geom is None:
            invalidas += 1
            continue
        identificador = _id_externo(feicao, propriedades, feicao["geometry"], campo_id)
        if identificador in validas:
            invalidas += 1
            continue
        validas[identificador] = {
            "id_externo": identificador,
            "geom": geom,
            "propriedades": propriedades,
        }
    return list(validas.values()), len(brutas), invalidas


# ---------------------------------------------------------------------------------------------
# Destino: camada de referência
# ---------------------------------------------------------------------------------------------


@transaction.atomic
def substituir_camada(conector: Conector, feicoes: list[dict]) -> dict[str, int]:
    """Troca as feições do conector numa transação. Devolve novos, atualizados e removidos."""
    antigas = {
        f.id_externo: (f.geom.wkb.tobytes(), f.propriedades)
        for f in FeicaoReferencia.objects.filter(conector=conector).only(
            "id_externo", "geom", "propriedades"
        )
    }
    novas = {f["id_externo"] for f in feicoes}
    novos = sum(1 for f in feicoes if f["id_externo"] not in antigas)
    atualizados = sum(
        1
        for f in feicoes
        if f["id_externo"] in antigas
        and antigas[f["id_externo"]] != (f["geom"].wkb.tobytes(), f["propriedades"])
    )
    removidos = sum(1 for i in antigas if i not in novas)
    FeicaoReferencia.objects.filter(conector=conector).delete()
    FeicaoReferencia.objects.bulk_create(
        [
            FeicaoReferencia(
                conector=conector,
                id_externo=f["id_externo"],
                geom=f["geom"],
                propriedades=f["propriedades"],
            )
            for f in feicoes
        ],
        batch_size=1000,
    )
    return {"novos": novos, "atualizados": atualizados, "removidos": removidos}


# ---------------------------------------------------------------------------------------------
# Destino: lote de importação em prévia
# ---------------------------------------------------------------------------------------------


def _responsavel(conector: Conector, usuario):
    responsavel = usuario or conector.criado_por
    if responsavel is None or not responsavel.is_active:
        raise ErroConector(
            "O conector não tem uma pessoa responsável ativa para receber a prévia. "
            "Edite o conector ou sincronize manualmente."
        )
    return responsavel


def criar_previa(conector: Conector, baixado: clientes.Baixado, usuario) -> LoteImportacao:
    modelo = conector.modelo_importacao
    if modelo is None:
        raise ErroConector("O conector não tem um modelo de importação.")
    responsavel = _responsavel(conector, usuario)
    escopo = area_do_escopo(responsavel)
    if escopo is None:
        raise ErroConector("A pessoa responsável não tem escopo territorial para importar árvores.")
    try:
        _, registros = importacao.ler_registros(
            baixado.conteudo, baixado.formato, modelo.srid, modelo.usar_ponto_interior
        )
        linhas = importacao.interpretar(
            registros, modelo.mapeamento, modelo.srid, fonte_ids=modelo.fonte, escopo=escopo
        )
    except importacao.ErroArquivo as exc:
        raise ErroConector(str(exc)) from exc
    return LoteImportacao.objects.create(
        arquivo_nome=f"{conector.nome}.{'csv' if baixado.formato == 'csv' else 'geojson'}"[:255],
        formato=baixado.formato,
        fonte=modelo.fonte,
        fonte_url=conector.url_origem,
        data_referencia=timezone.localdate(),
        mapeamento={**modelo.mapeamento, "srid": modelo.srid, "fonte_ids": modelo.fonte},
        usar_ponto_interior=modelo.usar_ponto_interior,
        modo=conector.modo,
        usuario=responsavel,
        total_linhas=len(linhas),
        linhas_validas=sum(1 for linha in linhas if not linha.erros),
        resumo=importacao.resumir(linhas),
        linhas=[linha.como_dict() for linha in linhas],
    )


def previa_pendente(conector: Conector) -> LoteImportacao | None:
    ids = ExecucaoConector.objects.filter(conector=conector, lote__isnull=False).values("lote_id")
    return LoteImportacao.objects.filter(pk__in=ids, estado=EstadoLote.PRE_VISUALIZADO).first()


# ---------------------------------------------------------------------------------------------
# Execução
# ---------------------------------------------------------------------------------------------


def iniciar_execucao(
    conector: Conector, usuario=None, origem: str = OrigemExecucao.MANUAL
) -> ExecucaoConector:
    """Abre o registro da execução; levanta ``ExecucaoEmAndamento`` se já há uma rodando."""
    with transaction.atomic():
        Conector.objects.select_for_update().get(pk=conector.pk)
        corte = timezone.now() - TEMPO_MAXIMO_EXECUCAO
        if ExecucaoConector.objects.filter(
            conector=conector, concluida_em__isnull=True, iniciada_em__gt=corte
        ).exists():
            raise ExecucaoEmAndamento
        return ExecucaoConector.objects.create(conector=conector, usuario=usuario, origem=origem)


def baixar_e_ler(conector: Conector) -> tuple[clientes.Baixado, list[dict], int, int]:
    baixado = clientes.baixar(conector.tipo, conector.url, conector.parametros)
    if conector.destino == DestinoConector.CAMADA_REFERENCIA:
        feicoes, recebidas, invalidas = ler_feicoes(baixado, conector.parametros)
        return baixado, feicoes, recebidas, invalidas
    return baixado, [], 0, 0


def executar(execucao: ExecucaoConector) -> ExecucaoConector:
    """Roda a sincronização e fecha o registro. Falhas viram ``erro``, nunca exceção."""
    conector = execucao.conector
    try:
        baixado, feicoes, recebidas, invalidas = baixar_e_ler(conector)
        if conector.destino == DestinoConector.CAMADA_REFERENCIA:
            contagem = substituir_camada(conector, feicoes)
            execucao.recebidos, execucao.invalidos = recebidas, invalidas
            execucao.novos = contagem["novos"]
            execucao.atualizados = contagem["atualizados"]
            execucao.removidos = contagem["removidos"]
        else:
            pendente = previa_pendente(conector)
            if pendente is not None:
                execucao.detalhe = (
                    f"A prévia do lote {pendente.numero} ainda aguarda confirmação ou "
                    "descarte; nenhuma nova prévia foi criada."
                )
            else:
                lote = criar_previa(conector, baixado, execucao.usuario)
                execucao.lote = lote
                execucao.recebidos = lote.total_linhas
                execucao.novos = lote.resumo.get("a_criar", 0)
                execucao.atualizados = lote.resumo.get("a_atualizar", 0)
                execucao.invalidos = lote.total_linhas - lote.linhas_validas
                _avisar_previa(lote, conector)
        execucao.sucesso = True
    except ErroConector as exc:
        execucao.erro = str(exc)
    except Exception as exc:  # noqa: BLE001 - registrar e seguir: a tela mostra o motivo
        logger.exception("Falha inesperada no conector %s", conector.pk)
        execucao.erro = f"Erro inesperado ao processar a fonte ({type(exc).__name__})."
    execucao.concluida_em = timezone.now()
    execucao.save()
    return execucao


def _avisar_previa(lote: LoteImportacao, conector: Conector) -> None:
    from itree.notificacoes import servicos

    servicos.previa_importacao(lote, conector.nome)


def sincronizar(conector: Conector, usuario=None, origem: str = OrigemExecucao.MANUAL):
    """Abre e executa na hora (comando e testes). A API e o agendador usam a fila."""
    return executar(iniciar_execucao(conector, usuario, origem))


def testar(tipo: str, url: str, parametros: dict) -> dict:
    """Busca sem gravar: quantas feições e as primeiras colunas (RF-INT-006)."""
    baixado = clientes.baixar(tipo, url, parametros)
    if baixado.formato == "csv":
        colunas, registros = importacao.ler_registros(baixado.conteudo, "csv")
        total, amostra = len(registros), registros[:3]
    else:
        feicoes = json.loads(baixado.conteudo)["features"]
        total = len(feicoes)
        colunas, amostra = [], []
        for f in feicoes[:200]:
            props = f.get("properties") if isinstance(f, dict) else None
            for chave in props if isinstance(props, dict) else []:
                if chave not in colunas:
                    colunas.append(chave)
        amostra = [
            f["properties"]
            for f in feicoes[:3]
            if isinstance(f, dict) and isinstance(f.get("properties"), dict)
        ]
    return {
        "total": total,
        "paginas": baixado.paginas,
        "colunas": [str(c) for c in colunas[:12]],
        "amostra": [{str(k): _curto(v) for k, v in linha.items()} for linha in amostra],
    }


def _curto(valor):
    texto = re.sub(r"\s+", " ", str(valor)) if valor is not None else ""
    return texto[:120]


# ---------------------------------------------------------------------------------------------
# Agendamento e situação
# ---------------------------------------------------------------------------------------------


def vencido(conector: Conector, agora=None) -> bool:
    """O conector automático, ativo, sem execução recente pela sua periodicidade."""
    intervalo = conector.intervalo
    if not conector.ativo or intervalo is None:
        return False
    ultima = ExecucaoConector.objects.filter(conector=conector).order_by("-iniciada_em").first()
    if ultima is None:
        return True
    return (agora or timezone.now()) >= ultima.iniciada_em + intervalo - FOLGA_AGENDADOR


def conectores_vencidos(agora=None) -> list[Conector]:
    candidatos = Conector.objects.filter(ativo=True).exclude(periodicidade=Periodicidade.MANUAL)
    return [c for c in candidatos if vencido(c, agora)]


def situacao(conector: Conector, ultima: ExecucaoConector | None, agora=None) -> str:
    """``nunca``, ``sincronizando``, ``falha``, ``atrasado`` ou ``ok``."""
    agora = agora or timezone.now()
    if ultima is None:
        return "nunca"
    if ultima.concluida_em is None and agora - ultima.iniciada_em <= TEMPO_MAXIMO_EXECUCAO:
        return "sincronizando"
    if not ultima.sucesso:
        return "falha"
    intervalo = conector.intervalo
    # Atrasado: passou de duas periodicidades sem execução (o agendador roda a cada hora).
    if conector.ativo and intervalo is not None and agora - ultima.iniciada_em > 2 * intervalo:
        return "atrasado"
    return "ok"
