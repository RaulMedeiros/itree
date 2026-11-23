"""Contrato de dados da detecção automática (ver docs/integracoes/deteccao-automatica.md).

Duas formas de chegar, uma só validação: o corpo JSON da API e o pacote (GeoJSON ou GeoPackage)
são traduzidos para o mesmo formato canônico e passam pelas mesmas regras. O resultado são
dicionários simples (JSON puro), porque o lote guarda a carga já validada até ser processado.

A regra de privacidade (LGPD) é do contrato: **toda foto precisa declarar ``anonimizada: true``**
(rostos e placas borrados na origem). A detecção que traz foto sem essa declaração é recusada
inteira, e a foto nunca é baixada nem guardada.
"""

import json
import math
from datetime import date, datetime

from django.conf import settings
from django.contrib.gis.geos import GEOSException, GEOSGeometry, MultiPolygon, Polygon

from .models import Sensor, TipoPontoPlantio

TIPOS = ("arvore", TipoPontoPlantio.BERCO_VAZIO.value, TipoPontoPlantio.TOCO.value)
CONTEXTOS = ("calcada", "canteiro", "praca", "lote_privado", "outro")
INTERFERENCIAS = ("fiacao", "poste", "fachada", "calcada_danificada")
SINAIS = ("inclinacao", "galhos_secos", "copa_rala", "morta")
MAX_CANDIDATAS = 3
LIMITE_ERROS_GUARDADOS = 500

# Medida -> (unidade canônica, {unidade aceita: fator para a canônica}, máximo plausível).
MEDIDAS = {
    "altura": ("m", {"m": 1.0, "cm": 0.01}, 100.0),
    "diametro_copa": ("m", {"m": 1.0, "cm": 0.01}, 100.0),
    "dap": ("cm", {"cm": 1.0, "mm": 0.1, "m": 100.0}, 500.0),
}
ROTULO_MEDIDA = {"altura": "altura", "diametro_copa": "diâmetro da copa", "dap": "DAP"}

TIPOS_FOTO = {
    "JPEG": ("image/jpeg", "jpg"),
    "PNG": ("image/png", "png"),
    "WEBP": ("image/webp", "webp"),
}


class ErroContrato(Exception):
    """O lote inteiro não obedece ao contrato (nada é gravado)."""

    def __init__(self, mensagens: list[str] | str):
        self.mensagens = [mensagens] if isinstance(mensagens, str) else list(mensagens)
        super().__init__("; ".join(self.mensagens))


class RecusaDeteccao(Exception):
    """Uma detecção não obedece ao contrato: ela é recusada, o resto do lote segue."""


def _numero(valor, nome: str, minimo=None, maximo=None, obrigatorio=True) -> float | None:
    if valor is None or valor == "":
        if obrigatorio:
            raise RecusaDeteccao(f"{nome}: campo obrigatório.")
        return None
    if isinstance(valor, bool):
        raise RecusaDeteccao(f"{nome}: número esperado.")
    try:
        numero = float(str(valor).replace(",", ".")) if isinstance(valor, str) else float(valor)
    except (TypeError, ValueError):
        raise RecusaDeteccao(f"{nome}: número esperado.") from None
    if not math.isfinite(numero):
        raise RecusaDeteccao(f"{nome}: número esperado.")
    if minimo is not None and numero < minimo:
        raise RecusaDeteccao(f"{nome}: o mínimo é {minimo}.")
    if maximo is not None and numero > maximo:
        raise RecusaDeteccao(f"{nome}: o máximo é {maximo}.")
    return numero


def _texto(valor, nome: str, maximo: int, obrigatorio=True) -> str:
    texto = "" if valor is None else str(valor).strip()
    if not texto and obrigatorio:
        raise ErroContrato(f"{nome}: campo obrigatório.")
    if len(texto) > maximo:
        raise ErroContrato(f"{nome}: no máximo {maximo} caracteres.")
    return texto


def _lista(valor) -> list:
    """Lista vinda de JSON, de texto JSON ou de texto separado por vírgula (GeoPackage)."""
    if valor is None or valor == "":
        return []
    if isinstance(valor, list):
        return valor
    if isinstance(valor, str):
        texto = valor.strip()
        if texto.startswith("["):
            try:
                return json.loads(texto)
            except json.JSONDecodeError:
                raise RecusaDeteccao("lista em JSON inválida.") from None
        return [p.strip() for p in texto.split(",") if p.strip()]
    raise RecusaDeteccao("lista esperada.")


def _objeto(valor, nome: str):
    if valor is None or valor == "" or isinstance(valor, dict):
        return valor or None
    if isinstance(valor, str) and valor.strip().startswith("{"):
        try:
            return json.loads(valor)
        except json.JSONDecodeError:
            raise RecusaDeteccao(f"{nome}: JSON inválido.") from None
    raise RecusaDeteccao(f"{nome}: objeto esperado.")


# ---------------------------------------------------------------------------------------------
# Lote
# ---------------------------------------------------------------------------------------------


def _poligono(valor, nome: str) -> MultiPolygon | None:
    objeto = valor
    if isinstance(valor, str) and valor.strip():
        try:
            objeto = json.loads(valor)
        except json.JSONDecodeError:
            raise ErroContrato(f"{nome}: GeoJSON inválido.") from None
    if not objeto:
        return None
    if isinstance(objeto, dict) and objeto.get("type") == "Feature":
        objeto = objeto.get("geometry")
    try:
        geom = GEOSGeometry(json.dumps(objeto), srid=4326)
    except (GEOSException, ValueError, TypeError):
        raise ErroContrato(f"{nome}: geometria GeoJSON inválida.") from None
    if isinstance(geom, Polygon):
        geom = MultiPolygon(geom, srid=4326)
    if not isinstance(geom, MultiPolygon) or geom.empty or not geom.valid:
        raise ErroContrato(f"{nome}: precisa ser um polígono válido (Polygon ou MultiPolygon).")
    return geom


def validar_lote(bruto) -> dict:
    """Metadados do lote, normalizados. Levanta ``ErroContrato``."""
    if not isinstance(bruto, dict):
        raise ErroContrato("lote: objeto esperado.")
    erros = []
    resultado: dict = {}
    for chave, campo, tamanho in (
        ("id", "id_externo", 100),
        ("projeto_origem", "projeto_origem", 150),
        ("versao_modelo", "versao_modelo", 100),
    ):
        try:
            resultado[campo] = _texto(bruto.get(chave), f"lote.{chave}", tamanho)
        except ErroContrato as exc:
            erros.extend(exc.mensagens)
    sensor = str(bruto.get("sensor") or "").strip()
    if sensor not in Sensor.values:
        erros.append(f"lote.sensor: use {' ou '.join(Sensor.values)}.")
    resultado["sensor"] = sensor
    try:
        capturado = bruto.get("capturado_em")
        if isinstance(capturado, datetime):
            capturado = capturado.date()
        resultado["capturado_em"] = (
            capturado if isinstance(capturado, date) else date.fromisoformat(str(capturado)[:10])
        )
    except ValueError:
        erros.append("lote.capturado_em: use uma data AAAA-MM-DD.")
    try:
        resultado["area_coberta"] = _poligono(bruto.get("area_coberta"), "lote.area_coberta")
    except ErroContrato as exc:
        erros.extend(exc.mensagens)
    if erros:
        raise ErroContrato(erros)
    return resultado


# ---------------------------------------------------------------------------------------------
# Detecção
# ---------------------------------------------------------------------------------------------


def _especies(bruto) -> list[dict]:
    itens = _lista(bruto)
    candidatas = []
    for item in itens:
        if isinstance(item, str):
            item = {"nome_cientifico": item}
        if not isinstance(item, dict):
            raise RecusaDeteccao("especies: cada candidata é um objeto.")
        nome = str(item.get("nome_cientifico") or "").strip()
        if not nome:
            raise RecusaDeteccao("especies: informe o nome_cientifico.")
        prob = _numero(item.get("probabilidade"), "especies.probabilidade", 0, 1, obrigatorio=False)
        candidatas.append({"nome_cientifico": nome[:200], "probabilidade": prob})
    if len(candidatas) > MAX_CANDIDATAS:
        raise RecusaDeteccao(f"especies: no máximo {MAX_CANDIDATAS} candidatas.")
    return candidatas


def _medidas(bruto) -> dict:
    objeto = _objeto(bruto, "medidas") or {}
    medidas = {}
    for tipo, (canonica, unidades, maximo) in MEDIDAS.items():
        item = objeto.get(tipo)
        if item is None:
            continue
        if not isinstance(item, dict):
            item = {"valor": item}
        unidade = str(item.get("unidade") or canonica).strip().lower()
        if unidade not in unidades:
            raise RecusaDeteccao(f"medidas.{tipo}: unidade {unidade!r}; use {', '.join(unidades)}.")
        fator = unidades[unidade]
        rotulo = f"medidas.{tipo}"
        valor = _numero(item.get("valor"), f"{rotulo}.valor")
        if valor <= 0 or valor * fator > maximo:
            raise RecusaDeteccao(f"{rotulo}: valor fora do plausível (até {maximo} {canonica}).")
        incerteza = _numero(item.get("incerteza"), f"{rotulo}.incerteza", 0, obrigatorio=False)
        medidas[tipo] = {
            "valor": round(valor * fator, 2),
            "unidade": canonica,
            "incerteza": round(incerteza * fator, 2) if incerteza is not None else None,
        }
    return medidas


def _foto_valida(foto) -> dict:
    if not isinstance(foto, dict):
        raise RecusaDeteccao("fotos: cada foto é um objeto.")
    if foto.get("anonimizada") is not True:
        raise RecusaDeteccao(
            "foto sem 'anonimizada: true': rostos e placas precisam chegar borrados (LGPD)."
        )
    arquivo = str(foto.get("arquivo") or "").strip()
    url = str(foto.get("url") or "").strip()
    if bool(arquivo) == bool(url):
        raise RecusaDeteccao("fotos: informe 'arquivo' ou 'url', um dos dois.")
    capturada = foto.get("capturada_em")
    if capturada in (None, ""):
        raise RecusaDeteccao("fotos.capturada_em: data obrigatória.")
    try:
        datetime.fromisoformat(str(capturada).replace("Z", "+00:00"))
    except ValueError:
        raise RecusaDeteccao("fotos.capturada_em: use data e hora ISO 8601.") from None
    return {
        "arquivo": arquivo,
        "url": url,
        "capturada_em": str(capturada),
        "anonimizada": True,
        "ilustrativa": foto.get("ilustrativa") is True,
        "chave": "",
    }


def _fotos(bruto) -> list[dict]:
    fotos = [_foto_valida(f) for f in _lista(bruto)]
    maximo = settings.DETECCAO_MAX_FOTOS_POR_DETECCAO
    if len(fotos) > maximo:
        raise RecusaDeteccao(f"fotos: no máximo {maximo} por detecção.")
    return fotos


def _rotulos(bruto, validos: tuple, nome: str) -> list[str]:
    itens = [str(i).strip() for i in _lista(bruto)]
    invalidos = sorted(set(itens) - set(validos))
    if invalidos:
        raise RecusaDeteccao(f"{nome}: valor(es) desconhecido(s) {', '.join(invalidos)}.")
    return list(dict.fromkeys(itens))


def validar_deteccao(bruta) -> dict:
    """Detecção normalizada. Levanta ``RecusaDeteccao`` com o motivo, que cabe na tela."""
    if not isinstance(bruta, dict):
        raise RecusaDeteccao("detecção: objeto esperado.")
    ident = str(bruta.get("id") or "").strip()
    if not ident or len(ident) > 100:
        raise RecusaDeteccao("id: obrigatório, até 100 caracteres.")
    tipo = str(bruta.get("tipo") or "arvore").strip()
    if tipo not in TIPOS:
        raise RecusaDeteccao(f"tipo: use {', '.join(TIPOS)}.")
    local = bruta.get("localizacao")
    if not isinstance(local, dict):
        raise RecusaDeteccao("localizacao: informe longitude e latitude (WGS 84).")
    lon = _numero(local.get("longitude"), "localizacao.longitude", -180, 180)
    lat = _numero(local.get("latitude"), "localizacao.latitude", -90, 90)
    incerteza = _numero(bruta.get("incerteza_m"), "incerteza_m", 0.01, 100)
    confianca = _numero(bruta.get("confianca"), "confianca", 0, 1)
    contexto = str(bruta.get("contexto") or "").strip()
    if contexto and contexto not in CONTEXTOS:
        raise RecusaDeteccao(f"contexto: use {', '.join(CONTEXTOS)}.")
    copa = _objeto(bruta.get("copa"), "copa")
    if copa is not None:
        try:
            geom = GEOSGeometry(json.dumps(copa), srid=4326)
        except (GEOSException, ValueError, TypeError):
            raise RecusaDeteccao("copa: geometria GeoJSON inválida.") from None
        if geom.geom_type not in ("Polygon", "MultiPolygon") or geom.empty or not geom.valid:
            raise RecusaDeteccao("copa: precisa ser um polígono válido.")
    return {
        "id": ident,
        "rastreamento": str(bruta.get("id_rastreamento") or "").strip()[:100],
        "tipo": tipo,
        "longitude": lon,
        "latitude": lat,
        "incerteza_m": incerteza,
        "confianca": confianca,
        "especies": _especies(bruta.get("especies")),
        "medidas": _medidas(bruta.get("medidas")),
        "copa": copa,
        "area_copa_m2": _numero(bruta.get("area_copa_m2"), "area_copa_m2", 0, obrigatorio=False),
        "contexto": contexto,
        "interferencias": _rotulos(bruta.get("interferencias"), INTERFERENCIAS, "interferencias"),
        "sinais": _rotulos(bruta.get("sinais"), SINAIS, "sinais"),
        "qualidade_imagem": _numero(
            bruta.get("qualidade_imagem"), "qualidade_imagem", 0, 1, obrigatorio=False
        ),
        "fotos": _fotos(bruta.get("fotos")),
    }


def validar_deteccoes(brutas) -> tuple[list[dict], list[dict]]:
    """(válidas, recusadas). Cada recusa é ``{id, motivo, longitude, latitude}``; id repetido no
    lote recusa a segunda ocorrência. Limite de detecções por lote levanta ``ErroContrato``."""
    if not isinstance(brutas, list) or not brutas:
        raise ErroContrato("deteccoes: lista com ao menos uma detecção.")
    if len(brutas) > settings.DETECCAO_MAX_DETECCOES:
        raise ErroContrato(
            f"deteccoes: {len(brutas)} detecções; o limite por lote é "
            f"{settings.DETECCAO_MAX_DETECCOES}."
        )
    validas, recusadas, vistos = [], [], set()
    for indice, bruta in enumerate(brutas, start=1):
        ident = str(bruta.get("id")) if isinstance(bruta, dict) and bruta.get("id") else ""
        try:
            deteccao = validar_deteccao(bruta)
            if deteccao["id"] in vistos:
                raise RecusaDeteccao("id repetido no lote.")
            vistos.add(deteccao["id"])
            validas.append(deteccao)
        except RecusaDeteccao as exc:
            local = bruta.get("localizacao") if isinstance(bruta, dict) else None
            recusa = {"id": ident or f"#{indice}", "motivo": str(exc)}
            if isinstance(local, dict):
                try:
                    lon, lat = float(local["longitude"]), float(local["latitude"])
                except (KeyError, TypeError, ValueError):
                    lon = lat = None
                # NaN e infinito não cabem em JSON: guardá-los derrubaria o lote inteiro.
                if lon is not None and math.isfinite(lon) and math.isfinite(lat):
                    recusa["longitude"], recusa["latitude"] = lon, lat
            recusadas.append(recusa)
    return validas, recusadas


def agrupar(deteccoes: list[dict]) -> list[list[dict]]:
    """Detecções com o mesmo id de rastreamento e o mesmo tipo formam um grupo (uma árvore).
    Sem rastreamento, cada detecção é um grupo. A ordem de chegada é preservada."""
    grupos: dict[tuple, list[dict]] = {}
    for indice, d in enumerate(deteccoes):
        chave = (d["rastreamento"], d["tipo"]) if d["rastreamento"] else ("", indice)
        grupos.setdefault(chave, []).append(d)
    return list(grupos.values())


# ---------------------------------------------------------------------------------------------
# Pacote: registros planos (GeoJSON, GeoPackage) -> formato da API
# ---------------------------------------------------------------------------------------------

_MEDIDAS_PLANAS = {
    "altura": ("altura_m", "altura_incerteza_m", "m"),
    "diametro_copa": ("diametro_copa_m", "diametro_copa_incerteza_m", "m"),
    "dap": ("dap_cm", "dap_incerteza_cm", "cm"),
}


def deteccao_de_registro(registro: dict) -> dict:
    """Traduz um registro do pacote (propriedades da feição + ``__lon``/``__lat``) para o formato
    da API. Campos de lista e objetos podem vir como texto JSON (GeoPackage não tem listas)."""
    bruta: dict = {
        "id": registro.get("id_deteccao") or registro.get("id"),
        "id_rastreamento": registro.get("id_rastreamento"),
        "tipo": registro.get("tipo") or "arvore",
        "incerteza_m": registro.get("incerteza_m"),
        "confianca": registro.get("confianca"),
        "contexto": registro.get("contexto"),
        "interferencias": registro.get("interferencias"),
        "sinais": registro.get("sinais"),
        "qualidade_imagem": registro.get("qualidade_imagem"),
        "area_copa_m2": registro.get("area_copa_m2"),
        "copa": registro.get("copa"),
        "fotos": registro.get("fotos"),
    }
    if registro.get("__lon") is not None and registro.get("__lat") is not None:
        bruta["localizacao"] = {"longitude": registro["__lon"], "latitude": registro["__lat"]}
    especies = registro.get("especies")
    if not especies and registro.get("especie_sugerida"):
        especies = [
            {
                "nome_cientifico": registro["especie_sugerida"],
                "probabilidade": registro.get("especie_probabilidade"),
            }
        ]
    bruta["especies"] = especies
    medidas = dict(_objeto(registro.get("medidas"), "medidas") or {})
    for tipo, (valor, incerteza, unidade) in _MEDIDAS_PLANAS.items():
        if registro.get(valor) not in (None, ""):
            medidas[tipo] = {
                "valor": registro[valor],
                "unidade": unidade,
                "incerteza": registro.get(incerteza),
            }
    bruta["medidas"] = medidas or None
    return bruta
