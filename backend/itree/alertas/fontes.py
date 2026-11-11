"""Leitura e ingestão de alertas das fontes externas (T-05 §3).

Cada fonte vira uma lista de ``Registro`` normalizados. A ingestão é idempotente
por (fonte, identificador externo), guarda os atributos originais, a data de
detecção separada da data de ingestão, e só mantém o que intersecta o município.

Disponibilidade, licença, formato e limites de cada API precisam ser
verificados antes do uso produtivo (DP-11). O formato dos arquivos aceitos
segue as publicações conhecidas; colunas alternativas são reconhecidas.
"""

import csv
import hashlib
import io
import json
import tempfile
import unicodedata
import zipfile
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from django.conf import settings
from django.contrib.gis.gdal import CoordTransform, SpatialReference
from django.contrib.gis.geos import GEOSGeometry, Point
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from itree.core.geo import SRID_METRICO, ampliar
from itree.notificacoes import servicos as notificacoes
from itree.territorio.models import Territorio, TipoTerritorio

from . import proximidade
from .models import AlertaAmbiental, FonteAlerta, IngestaoAlertas, TipoAlerta


class ErroFonte(Exception):
    pass


@dataclass
class Registro:
    id_externo: str
    geom: GEOSGeometry
    data_deteccao: datetime
    propriedades: dict
    src_original: str = "EPSG:4326"


def _primeiro(dados: dict, *chaves: str):
    minusculas = {str(k).lower(): v for k, v in dados.items()}
    for chave in chaves:
        valor = minusculas.get(chave.lower())
        if valor not in (None, ""):
            return valor
    return None


def _data(valor) -> datetime | None:
    if valor in (None, ""):
        return None
    texto = str(valor).strip().replace("/", "-")
    dt = parse_datetime(texto) or parse_datetime(texto.replace(" ", "T"))
    if dt is None and (d := parse_date(texto[:10])):
        dt = datetime(d.year, d.month, d.day)
    if dt is None:
        return None
    return dt if timezone.is_aware(dt) else timezone.make_aware(dt, UTC)


def _registro_foco(linha: dict) -> Registro | None:
    """Uma linha do CSV do BDQueimadas como ``Registro``; ``None`` se inválida."""
    lat = _primeiro(linha, "lat", "latitude")
    lon = _primeiro(linha, "lon", "longitude")
    quando = _data(_primeiro(linha, "data_hora_gmt", "datahora", "data_hora", "data"))
    try:
        ponto = Point(
            float(str(lon).replace(",", ".")), float(str(lat).replace(",", ".")), srid=4326
        )
    except (TypeError, ValueError):
        return None
    if quando is None:
        return None
    ident = _primeiro(linha, "id", "foco_id", "id_foco")
    if ident is None:
        # Sem identificador na fonte: deriva um estável dos atributos do foco.
        satelite = _primeiro(linha, "satelite") or ""
        chave = f"{ponto.x:.5f}|{ponto.y:.5f}|{quando.isoformat()}|{satelite}"
        ident = hashlib.sha1(chave.encode(), usedforsecurity=False).hexdigest()[:20]
    return Registro(str(ident), ponto, quando, dict(linha))


def ler_focos_csv(conteudo: bytes) -> tuple[list[Registro], int]:
    """BDQueimadas (CSV). Colunas reconhecidas: lat/latitude, lon/longitude,
    data_hora_gmt/datahora/data, id/foco_id e demais atributos preservados."""
    texto = conteudo.decode("utf-8-sig", errors="replace")
    try:
        dialeto = csv.Sniffer().sniff(texto[:4096], delimiters=",;")
    except csv.Error:
        dialeto = csv.excel
    registros, invalidos = [], 0
    for linha in csv.DictReader(io.StringIO(texto), dialect=dialeto):
        registro = _registro_foco(linha)
        if registro is None:
            invalidos += 1
        else:
            registros.append(registro)
    return registros, invalidos


def _sem_acento(texto: str) -> str:
    base = unicodedata.normalize("NFD", texto)
    return "".join(c for c in base if not unicodedata.combining(c)).strip().upper()


def ler_focos_em_fluxo(
    linhas: Iterable[str], estado: str | None = None
) -> tuple[list[Registro], int, int]:
    """Lê o CSV do BDQueimadas linha a linha, sem carregar o arquivo na memória.

    Com ``estado`` (coluna ``estado``, sem distinguir acento nem caixa: "Ceará"
    casa com "CEARÁ"), descarta as outras linhas **antes** de montar os registros;
    só as do estado ficam na memória. Devolve (registros, inválidos, lidas), em que
    ``lidas`` conta todas as linhas de dados do arquivo, do estado ou não.
    """
    leitor = csv.DictReader(linhas)
    alvo = _sem_acento(estado) if estado else None
    if alvo and leitor.fieldnames and "estado" not in [f.lower() for f in leitor.fieldnames]:
        raise ErroFonte("O CSV não tem a coluna 'estado'; não dá para filtrar pelo estado.")
    registros, invalidos, lidas = [], 0, 0
    for linha in leitor:
        lidas += 1
        if alvo and _sem_acento(str(_primeiro(linha, "estado") or "")) != alvo:
            continue
        registro = _registro_foco(linha)
        if registro is None:
            invalidos += 1
        else:
            registros.append(registro)
    return registros, invalidos, lidas


CHAVES_GEOJSON = {
    FonteAlerta.INPE_DETER: {"id": ("gid", "id", "fid"), "data": ("view_date", "date", "data")},
    FonteAlerta.MAPBIOMAS: {
        "id": ("alertCode", "alert_code", "id"),
        "data": ("detectedAt", "detected_at", "data"),
    },
}


def ler_geojson(conteudo: bytes, fonte: str) -> tuple[list[Registro], int]:
    try:
        dados = json.loads(conteudo)
    except json.JSONDecodeError as exc:
        raise ErroFonte(f"GeoJSON inválido: {exc.msg}.") from exc
    feicoes = dados.get("features") if isinstance(dados, dict) else None
    if not isinstance(feicoes, list):
        raise ErroFonte("Esperada uma FeatureCollection.")
    src = "EPSG:4326"
    crs = (dados.get("crs") or {}).get("properties", {}).get("name", "")
    if crs and "4326" not in crs and "CRS84" not in crs:
        src = crs
    chaves = CHAVES_GEOJSON.get(fonte, {"id": ("id",), "data": ("data",)})
    registros, invalidos = [], 0
    for f in feicoes:
        props = dict(f.get("properties") or {})
        ident = _primeiro({**props, "id": f.get("id") or props.get("id")}, *chaves["id"])
        quando = _data(_primeiro(props, *chaves["data"]))
        try:
            geom = GEOSGeometry(json.dumps(f["geometry"]))
        except Exception:  # noqa: BLE001 - geometria ausente ou inválida
            invalidos += 1
            continue
        if ident is None or quando is None:
            invalidos += 1
            continue
        if src != "EPSG:4326":
            geom.srid = int(src.split(":")[-1])
            geom.transform(4326)
        else:
            geom.srid = 4326
        registros.append(Registro(str(ident), geom, quando, props, src))
    return registros, invalidos


def ler(conteudo: bytes, fonte: str) -> tuple[list[Registro], int]:
    if fonte == FonteAlerta.INPE_FOCOS:
        return ler_focos_csv(conteudo)
    return ler_geojson(conteudo, fonte)


FUSO_FORTALEZA = ZoneInfo("America/Fortaleza")


def resolver_url(url: str, agora: datetime | None = None) -> str:
    """Substitui os marcadores de data da URL, no fuso de Fortaleza.

    ``{data}`` vira AAAAMMDD do dia anterior (o arquivo diário do INPE só fecha
    no dia seguinte) e ``{data_hoje}`` vira AAAAMMDD do dia corrente. URLs sem
    marcador não mudam.
    """
    hoje = (agora or timezone.now()).astimezone(FUSO_FORTALEZA).date()
    return url.replace("{data}", (hoje - timedelta(days=1)).strftime("%Y%m%d")).replace(
        "{data_hoje}", hoje.strftime("%Y%m%d")
    )


def baixar(url: str) -> bytes:
    """Busca o arquivo da fonte (WFS do TerraBrasilis com saída GeoJSON, CSV do
    BDQueimadas). Tempo limite curto; falhas ficam registradas na ingestão."""
    resposta = requests.get(url, timeout=getattr(settings, "ALERTAS_TIMEOUT", 60))
    resposta.raise_for_status()
    return resposta.content


TIPO_POR_FONTE = {
    FonteAlerta.INPE_FOCOS: TipoAlerta.FOCO_CALOR,
    FonteAlerta.INPE_DETER: TipoAlerta.SUPRESSAO,
    FonteAlerta.MAPBIOMAS: TipoAlerta.SUPRESSAO,
}


# Órgão e licença de cada fonte, gravados em cada ingestão (RN-PROV-003, DP-11).
# O INPE não declara licença nos dados de focos de calor: registra-se isso, com a
# citação pedida, até haver resposta do órgão.
PROVENIENCIA_FONTE = {
    FonteAlerta.INPE_FOCOS: {
        "orgao": "INPE, Programa Queimadas",
        "licenca": "Não declarada pela fonte (DP-11). Citar: INPE, Programa Queimadas.",
    },
    FonteAlerta.INPE_DETER: {
        "orgao": "INPE, TerraBrasilis",
        "licenca": "Não declarada para os dados (o WMS informa Fees e AccessConstraints "
        "como 'none'). Citar: INPE, TerraBrasilis (DP-11).",
    },
    FonteAlerta.MAPBIOMAS: {
        "orgao": "MapBiomas Alerta",
        "licenca": "Termos da API do MapBiomas, ainda não verificados (DP-11).",
    },
}


def criar_ingestao(fonte: str, origem: str, usuario=None, **extras) -> IngestaoAlertas:
    return IngestaoAlertas.objects.create(
        fonte=fonte,
        origem=origem[:500],
        usuario=usuario,
        **PROVENIENCIA_FONTE.get(fonte, {}),
        **extras,
    )


def ingerir(fonte: str, conteudo: bytes, origem: str, usuario=None) -> IngestaoAlertas:
    """Ingere o conteúdo, registrando o resultado mesmo em caso de erro."""
    return ingerir_leitura(fonte, lambda: ler(conteudo, fonte), origem, usuario)


def ingerir_leitura(
    fonte: str,
    leitor: Callable[[], tuple[list[Registro], int]],
    origem: str,
    usuario=None,
    *,
    notificar: bool = True,
) -> IngestaoAlertas:
    """Corpo de ``ingerir``, com a leitura separada: ``leitor`` devolve (registros,
    inválidos). Serve a quem já filtra na leitura (backfill mensal do INPE) e
    mantém a mesma ingestão idempotente, com os mesmos filtros e a mesma proveniência.
    ``notificar=False`` não avisa os usuários (carga histórica, sem novidade)."""
    ingestao = criar_ingestao(fonte, origem, usuario)
    criados: list[AlertaAmbiental] = []
    try:
        registros, invalidos = leitor()
        municipio = (
            Territorio.objects.filter(tipo=TipoTerritorio.MUNICIPIO)
            .values_list("geom", flat=True)
            .first()
        )
        if municipio is None:
            raise ErroFonte(
                "Nenhum município cadastrado: importe os territórios antes dos alertas."
            )
        bairros = list(
            Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO).only("id", "nome", "geom")
        )
        ingestao.recebidos = len(registros)
        ingestao.invalidos = invalidos
        if registros:
            ingestao.data_referencia = max(r.data_deteccao for r in registros).date()
        existentes = set(
            AlertaAmbiental.objects.filter(
                fonte=fonte, id_externo__in=[r.id_externo for r in registros]
            ).values_list("id_externo", flat=True)
        )
        foco = fonte == FonteAlerta.INPE_FOCOS
        raio_km = settings.ALERTAS_FOCOS_RAIO_AREA_VERDE_KM
        # Focos: o município ganha um buffer de raio_km, para pegar o foco logo além do
        # limite que fica junto de um parque ou unidade de conservação.
        busca = ampliar(municipio, raio_km * 1000) if foco else municipio
        transformacao = CoordTransform(SpatialReference(4326), SpatialReference(SRID_METRICO))
        for r in registros:
            if r.id_externo in existentes:
                ingestao.ja_existentes += 1
                continue
            dentro = municipio.intersects(r.geom)
            if not dentro and not (foco and busca.intersects(r.geom)):
                ingestao.fora_do_municipio += 1
                continue
            proxima = proximidade.area_verde_proxima(r.geom, raio_km) if foco else None
            if not dentro and proxima is None:
                # Fora do município, só interessa o foco junto de área verde.
                ingestao.fora_do_municipio += 1
                continue
            area = None
            if r.geom.geom_type in ("Polygon", "MultiPolygon"):
                metrica = r.geom.clone()
                metrica.transform(transformacao)
                area = round(metrica.area / 10_000, 2)
            novo = AlertaAmbiental.objects.create(
                fonte=fonte,
                id_externo=r.id_externo,
                tipo=TIPO_POR_FONTE[fonte],
                geom=r.geom,
                src_original=r.src_original,
                area_ha=area,
                area_verde_proxima=proxima,
                data_deteccao=r.data_deteccao,
                propriedades=r.propriedades,
                bairros=[
                    {"id": str(b.id), "nome": b.nome} for b in bairros if b.geom.intersects(r.geom)
                ],
            )
            existentes.add(r.id_externo)
            criados.append(novo)
            ingestao.novos += 1
        ingestao.sucesso = True
    except (ErroFonte, requests.RequestException) as exc:
        ingestao.erro = str(exc)
    except Exception as exc:  # noqa: BLE001 - registrar qualquer falha da fonte
        ingestao.erro = f"Falha inesperada: {exc.__class__.__name__}: {exc}"
    ingestao.concluida_em = timezone.now()
    ingestao.save()
    if notificar:
        notificacoes.alertas_novos(criados)
    return ingestao


# --- Backfill mensal do INPE ---------------------------------------------------

URL_FOCOS_MENSAL = "https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/mensal/Brasil/"
ESTADO_PADRAO_FOCOS = "Ceará"


def urls_focos_mensal(ano: int, mes: int, base: str = URL_FOCOS_MENSAL) -> list[str]:
    """URLs candidatas do arquivo mensal: .zip até 2023 e .csv a partir de 2024, com a
    outra extensão como reserva (a publicação do INPE já mudou de formato antes)."""
    nome = f"focos_mensal_br_{ano:04d}{mes:02d}"
    extensoes = ["zip", "csv"] if ano <= 2023 else ["csv", "zip"]
    return [f"{base.rstrip('/')}/{nome}.{ext}" for ext in extensoes]


@contextmanager
def abrir_focos_mensal(url: str) -> Iterator[Iterable[str]]:
    """Abre o CSV mensal como fluxo de linhas de texto, sem carregá-lo inteiro.

    O .csv é lido direto da resposta; o .zip (que exige acesso aleatório) vai para
    um arquivo temporário em disco e o CSV é lido de dentro dele, em fluxo.
    """
    timeout = getattr(settings, "ALERTAS_TIMEOUT", 60)
    with requests.get(url, stream=True, timeout=timeout) as resposta:
        resposta.raise_for_status()
        if url.endswith(".zip"):
            with tempfile.TemporaryFile() as temporario:
                for bloco in resposta.iter_content(1 << 20):
                    temporario.write(bloco)
                temporario.seek(0)
                with zipfile.ZipFile(temporario) as pacote:
                    membros = [n for n in pacote.namelist() if n.lower().endswith(".csv")]
                    if not membros:
                        raise ErroFonte("O .zip do INPE não traz nenhum CSV.")
                    with pacote.open(membros[0]) as bruto:
                        yield io.TextIOWrapper(
                            bruto, encoding="utf-8-sig", errors="replace", newline=""
                        )
        else:
            resposta.encoding = "utf-8-sig"
            yield resposta.iter_lines(decode_unicode=True)


def ingerir_focos_mensal(
    ano: int, mes: int, estado: str | None = ESTADO_PADRAO_FOCOS, base: str = URL_FOCOS_MENSAL
) -> tuple[IngestaoAlertas, int]:
    """Ingere um mês do BDQueimadas pelo mesmo ``ingerir`` (idempotente pelo id do foco),
    filtrando pelo estado na leitura. Devolve a ingestão e o total de linhas do arquivo."""
    urls = urls_focos_mensal(ano, mes, base)
    lidas = 0
    usada = urls[0]

    def leitor() -> tuple[list[Registro], int]:
        nonlocal lidas, usada
        for i, url in enumerate(urls):
            usada = url
            try:
                with abrir_focos_mensal(url) as linhas:
                    registros, invalidos, lidas = ler_focos_em_fluxo(linhas, estado)
                return registros, invalidos
            except requests.HTTPError as exc:
                ultimo = i == len(urls) - 1
                if ultimo or exc.response is None or exc.response.status_code != 404:
                    raise
        raise ErroFonte("Nenhuma URL candidata.")  # inalcançável; satisfaz o verificador

    ingestao = ingerir_leitura(FonteAlerta.INPE_FOCOS, leitor, usada, notificar=False)
    # A origem real só se conhece depois de tentar; grava a que foi usada.
    if ingestao.origem != usada[:500]:
        ingestao.origem = usada[:500]
        ingestao.save(update_fields=["origem"])
    return ingestao, lidas
