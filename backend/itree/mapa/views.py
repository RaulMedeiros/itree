"""Mapa (W-02): vector tiles com escopo territorial, busca e metadados de camadas."""

import re

from django.db import connection
from django.db.models import Count, Max, Min, Q
from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from itree.areas_verdes.models import AreaVerde
from itree.contas.acesso import area_do_escopo, filtrar_por_escopo
from itree.core.parametros import uuid_do_parametro
from itree.iluminacao.servico import resumo_da_iluminacao
from itree.indicadores.populacao_indicadores import situacao_das_fontes
from itree.inventario.models import Arvore, SituacaoArvore
from itree.inventario.views import filtrar_arvores
from itree.mapa import tempo
from itree.ocorrencias.models import ESTADOS_FINAIS, Ocorrencia
from itree.territorio.models import Territorio

TIPO_MVT = "application/vnd.mapbox-vector-tile"
ZOOM_INDIVIDUAL = 16
# Pontos de iluminação pública (~150 mil): sem agrupamento, só a partir deste zoom. Abaixo dele o
# tile vem vazio. O mesmo valor está em `apps/web/src/mapa/simbologia.ts`.
ZOOM_ILUMINACAO = 15
CIRCUNFERENCIA_3857 = 40075016.68557849
# Zoom até o qual as células de agrupamento são maiores (menos agrupamentos amontoados).
ZOOM_MUNICIPIO = 11
# Abaixo deste zoom, as árvores vêm agrupadas por bairro (um grupo por bairro, no ponto interior
# do polígono), e não em células (M-29). O mesmo valor está em `apps/web/src/mapa/simbologia.ts`.
ZOOM_AGRUPA_BAIRRO = 12
# O MapLibre desenha tiles vetoriais de 512 px. A célula é dimensionada em pixels de tela,
# acima do maior ícone de grupo (46 px, em `simbologia.ts`), para as bolhas não se tocarem.
TILE_PX = 512
CELULA_PX_MUNICIPIO = 72
CELULA_PX_BAIRRO = 56


def tamanho_da_celula(z: int) -> float:
    """Lado da célula de agrupamento (m, EPSG:3857). O lado em pixels de tela é fixo por faixa
    de zoom e maior que o ícone do grupo; em zoom de município a célula é ainda maior, porque
    ali as contagens são altas e os ícones, grandes (R2-07, C-08)."""
    px = CELULA_PX_MUNICIPIO if z <= ZOOM_MUNICIPIO else CELULA_PX_BAIRRO
    return CIRCUNFERENCIA_3857 / 2**z * px / TILE_PX


def _filtros_arvores(params, periodo: "tempo.Periodo | None" = None) -> tuple[str, dict]:
    clausulas, valores = [], {}
    if especie := params.get("especie"):
        clausulas.append("a.especie_id = %(especie)s")
        valores["especie"] = str(uuid_do_parametro(especie, "especie"))
    if estado := params.get("especie_estado"):
        clausulas.append("a.especie_estado = %(especie_estado)s")
        valores["especie_estado"] = estado
    if origem := params.get("localizacao_origem"):
        clausulas.append("a.localizacao_origem = %(localizacao_origem)s")
        valores["localizacao_origem"] = origem
    if bairro := params.get("bairro"):
        clausulas.append("a.bairro_id = %(bairro)s")
        valores["bairro"] = str(uuid_do_parametro(bairro, "bairro"))
    if dias := params.get("sem_inspecao_dias"):
        try:
            valores["dias"] = int(dias)
        except ValueError:
            valores["dias"] = 0
        if periodo is None:
            clausulas.append(
                "(a.ultima_inspecao_em IS NULL"
                " OR a.ultima_inspecao_em < now() - make_interval(days => %(dias)s))"
            )
        else:
            ultima = tempo.ultima_inspecao()
            clausulas.append(
                f"({ultima} IS NULL OR {ultima} < %(t_fim)s - make_interval(days => %(dias)s))"
            )
    if condicao := params.get("condicao_aparente"):
        if periodo is None:
            clausulas.append("a.condicao_aparente = %(condicao)s")
        else:
            clausulas.append(f"{tempo.EXPRESSAO_CONDICAO} = %(condicao)s")
        valores["condicao"] = (
            "nao_avaliada"
            if periodo and condicao == "sem"
            else ("" if condicao == "sem" else condicao)
        )
    return "".join(f" AND {c}" for c in clausulas), valores


def _filtros_ocorrencias(params, periodo: "tempo.Periodo | None" = None) -> tuple[str, dict]:
    clausulas, valores = [], {}
    estado = params.get("estado", "abertas")
    if periodo is not None:
        # Na linha do tempo, "abertas" são as abertas na data; "todas", as registradas até ela.
        # Estados escolhidos valem como estão hoje, limitados às registradas até a data.
        if estado == "abertas":
            clausulas.append(tempo.ocorrencia_aberta_na_data(periodo))
        else:
            clausulas.append(tempo.ocorrencia_registrada_ate(periodo))
            if estado != "todas":
                clausulas.append("o.estado = ANY(%(estados)s)")
                valores["estados"] = estado.split(",")
        valores.update(periodo.parametros())
    elif estado == "abertas":
        clausulas.append("o.estado <> ALL(%(finais)s)")
        valores["finais"] = list(ESTADOS_FINAIS)
    elif estado != "todas":
        clausulas.append("o.estado = ANY(%(estados)s)")
        valores["estados"] = estado.split(",")
    if prioridade := params.get("prioridade"):
        clausulas.append("o.prioridade = %(prioridade)s")
        valores["prioridade"] = "" if prioridade == "sem" else prioridade
    if tipo := params.get("tipo"):
        clausulas.append("o.tipo_id = %(tipo)s")
        valores["tipo"] = str(uuid_do_parametro(tipo, "tipo"))
    if bairro := params.get("bairro"):
        clausulas.append("o.bairro_id = %(bairro)s")
        valores["bairro"] = str(uuid_do_parametro(bairro, "bairro"))
    return "".join(f" AND {c}" for c in clausulas), valores


def _filtros_tarefas(params) -> tuple[str, dict]:
    extra, valores = " AND t.estado NOT IN ('concluida', 'cancelada')", {}
    if bairro := params.get("bairro"):
        # Mesmo critério da lista de tarefas: o alvo está dentro do bairro.
        extra += (
            " AND ST_Intersects(t.geom,"
            " (SELECT b.geom FROM territorio_territorio b WHERE b.id = %(bairro)s))"
        )
        valores["bairro"] = str(uuid_do_parametro(bairro, "bairro"))
    return extra, valores


# Da menos para a mais grave; o índice (base 1) é o rank usado na agregação por célula.
_CONDICOES_POR_GRAVIDADE = ["nao_avaliada", "boa", "regular", "ruim", "morta"]
_RANK_CONDICAO = " ".join(f"WHEN '{c}' THEN {i}" for i, c in enumerate(_CONDICOES_POR_GRAVIDADE, 1))
_NOMES_CONDICAO = ", ".join(f"'{c}'" for c in _CONDICOES_POR_GRAVIDADE)
SQL_PIOR_CONDICAO = f"(ARRAY[{_NOMES_CONDICAO}])[max(CASE condicao {_RANK_CONDICAO} ELSE 1 END)]"


def _sql_base_arvores(periodo: "tempo.Periodo | None") -> str:
    """Árvores do tile. No presente: as ativas, com a condição do cadastro. Na linha do tempo: as
    que existiam no período, com a condição da última inspeção validada até ele (``tempo``)."""
    if periodo is None:
        situacao = "a.situacao = 'ativa'"
        condicao = "a.condicao_aparente"
        juncao = ""
    else:
        situacao = tempo.arvore_na_data(periodo)
        condicao = tempo.EXPRESSAO_CONDICAO
        juncao = tempo.juncao_condicao()
    return f"""
            SELECT a.id::text AS id, a.numero, a.especie_estado, a.localizacao_origem,
                   a.confirmada,
                   COALESCE(NULLIF({condicao}, ''), 'nao_avaliada') AS condicao,
                   COALESCE(a.precisao_m, -1) AS precisao_m,
                   COALESCE(e.nome_cientifico, '') AS especie,
                   ST_Transform(a.geom, 3857) AS g3857
              FROM inventario_arvore a
              LEFT JOIN inventario_especie e ON e.id = a.especie_id{juncao}, env
             WHERE {situacao} AND a.geom IS NOT NULL
               AND a.geom && ST_Transform(env.g, 4326)
               AND ST_Intersects(a.geom, ST_GeomFromEWKB(%(area)s))
        """


CAMADAS = {
    "arvores": {
        "permissao": "mapa.ler",
        "filtros": _filtros_arvores,
        "base": lambda periodo: _sql_base_arvores(periodo),
        "propriedades": (
            "id, numero, especie_estado, localizacao_origem, confirmada, condicao,"
            " precisao_m, especie"
        ),
    },
    "ocorrencias": {
        "permissao": "ocorrencias.ler",
        "filtros": _filtros_ocorrencias,
        "base": """
            SELECT o.id::text AS id, o.numero, o.estado, o.prioridade, t.nome AS tipo,
                   o.risco_confirmado, ST_Transform(o.geom, 3857) AS g3857
              FROM ocorrencias_ocorrencia o
              JOIN ocorrencias_tipoocorrencia t ON t.id = o.tipo_id, env
             WHERE o.geom && ST_Transform(env.g, 4326)
               AND ST_Intersects(o.geom, ST_GeomFromEWKB(%(area)s))
        """,
        "propriedades": "id, numero, estado, prioridade, tipo, risco_confirmado",
    },
    "tarefas": {
        "permissao": "tarefas.ler",
        "filtros": _filtros_tarefas,
        "base": """
            SELECT t.id::text AS id, t.numero, t.tipo, t.estado,
                   (t.prazo IS NOT NULL AND t.prazo < current_date) AS atrasada,
                   ST_Transform(t.geom, 3857) AS g3857
              FROM tarefas_tarefa t, env
             WHERE t.geom && ST_Transform(env.g, 4326)
               AND ST_Intersects(t.geom, ST_GeomFromEWKB(%(area)s))
        """,
        "propriedades": "id, numero, tipo, estado, atrasada",
    },
    "iluminacao": {
        "permissao": "mapa.ler",
        "filtros": lambda params: ("", {}),
        "base": """
            SELECT p.codigo AS id, p.logradouro, p.poste_tipo AS poste,
                   COALESCE(p.altura_poste_min_m, -1) AS altura_min_m,
                   COALESCE(p.altura_poste_max_m, -1) AS altura_max_m,
                   COALESCE((
                       SELECT string_agg(
                                  x.tipo || CASE WHEN x.n > 1 THEN ' (' || x.n || ')' ELSE '' END,
                                  '; ' ORDER BY x.tipo)
                         FROM (SELECT l->>'tipo' AS tipo, count(*) AS n
                                 FROM jsonb_array_elements(p.lampadas) l GROUP BY 1) x
                   ), '') AS lampadas,
                   ST_Transform(p.geom, 3857) AS g3857
              FROM iluminacao_pontoiluminacao p, env
             WHERE p.geom && ST_Transform(env.g, 4326)
               AND ST_Intersects(p.geom, ST_GeomFromEWKB(%(area)s))
        """,
        "propriedades": "id, logradouro, poste, altura_min_m, altura_max_m, lampadas",
    },
}


def _base_da_camada(definicao: dict, periodo: "tempo.Periodo | None") -> str:
    base = definicao["base"]
    return base(periodo) if callable(base) else base


def _sql_arvores_por_bairro(definicao: dict, extra: str, periodo: "tempo.Periodo | None") -> str:
    """Tile de árvores em zoom afastado: um grupo por bairro (M-29).

    O grupo conta **todas** as árvores do bairro dentro do escopo e dos filtros, e não só as que
    caem no tile, e é desenhado no ponto interior do polígono (``ST_PointOnSurface``, sempre dentro
    do bairro, ao contrário do centroide de um bairro em "C"). Só o tile que contém esse ponto
    desenha o grupo. Leva a contagem (``quantidade``), a pior condição (``pior_condicao``, para o
    anel) e o nome do bairro (``bairro``), que também distingue o grupo de bairro da árvore
    individual. Árvores sem bairro não somem: seguem em células, como nos zooms médios."""
    propriedades = [p.strip() for p in definicao["propriedades"].split(",")]
    celulas = ",\n                   ".join(
        f"CASE WHEN count(*) = 1 THEN (array_agg({p}))[1] END AS {p}" for p in propriedades
    )
    nulas = ", ".join("NULL" for _ in propriedades)
    colunas = ", ".join(propriedades)
    if periodo is None:
        situacao, condicao, juncao = "a.situacao = 'ativa'", "a.condicao_aparente", ""
    else:
        situacao = tempo.arvore_na_data(periodo)
        condicao, juncao = tempo.EXPRESSAO_CONDICAO, tempo.juncao_condicao()
    return f"""
        WITH env AS (SELECT ST_TileEnvelope(%(z)s, %(x)s, %(y)s) AS g),
             pontos AS (
                SELECT t.id, t.nome, ST_Transform(ST_PointOnSurface(t.geom), 3857) AS p
                  FROM territorio_territorio t, env
                 WHERE t.tipo = 'bairro' AND t.geom && ST_Transform(env.g, 4326)
             ),
             no_tile AS (SELECT pontos.* FROM pontos, env WHERE pontos.p && env.g),
             base AS (
                SELECT a.bairro_id,
                       COALESCE(NULLIF({condicao}, ''), 'nao_avaliada') AS condicao
                  FROM inventario_arvore a{juncao}
                 WHERE {situacao} AND a.geom IS NOT NULL
                   AND a.bairro_id IN (SELECT id FROM no_tile)
                   AND ST_Intersects(a.geom, ST_GeomFromEWKB(%(area)s)){extra}
             ),
             por_bairro AS (
                SELECT count(*)::int AS quantidade, {SQL_PIOR_CONDICAO} AS pior_condicao,
                       n.nome AS bairro, ST_AsMVTGeom(n.p, env.g, 4096, 64, true) AS geom
                  FROM base JOIN no_tile n ON n.id = base.bairro_id, env
                 GROUP BY n.id, n.nome, n.p, env.g
             ),
             avulsas AS ({_base_da_camada(definicao, periodo)}{extra} AND a.bairro_id IS NULL),
             em_celulas AS (
                SELECT count(*)::int AS quantidade, {celulas},
                       {SQL_PIOR_CONDICAO} AS pior_condicao,
                       NULL::text AS bairro,
                       ST_AsMVTGeom(ST_Centroid(ST_Collect(g3857)), env.g, 4096, 64, true) AS geom
                  FROM avulsas, env
                 GROUP BY ST_SnapToGrid(g3857, %(celula)s), env.g
             )
        SELECT ST_AsMVT(t, %(camada)s, 4096, 'geom')
          FROM (
            SELECT quantidade, {colunas}, pior_condicao, bairro, geom FROM em_celulas
            UNION ALL
            SELECT quantidade, {nulas}, pior_condicao, bairro, geom FROM por_bairro
          ) t
    """


PARAM_ATE = (
    "Linha do tempo (AAAA-MM): situação ao fim desse mês. Sem ele, o mapa mostra o presente. "
    "Vale para árvores, ocorrências e alertas; iluminação e tarefas ignoram."
)
PARAM_DESDE = "Modo intervalo (AAAA-MM): do começo deste mês ao fim de `ate`."


@extend_schema(
    operation_id="mapa_tile",
    parameters=[
        OpenApiParameter("especie", str),
        OpenApiParameter("especie_estado", str),
        OpenApiParameter("localizacao_origem", str),
        OpenApiParameter("bairro", str),
        OpenApiParameter("estado", str),
        OpenApiParameter("prioridade", str),
        OpenApiParameter("tipo", str),
        OpenApiParameter("ate", str, description=PARAM_ATE),
        OpenApiParameter("desde", str, description=PARAM_DESDE),
    ],
    responses={(200, TIPO_MVT): OpenApiTypes.BINARY},
)
@api_view(["GET"])
def tile(request: Request, camada: str, z: int, x: int, y: int):
    """Vector tile (MVT) da camada, restrito ao escopo do usuário.

    Abaixo do zoom 16, os pontos são agrupados em células com a contagem
    (``quantidade``); a partir dele, cada registro vira uma feição. Só as árvores, abaixo do zoom
    12, vêm agrupadas por bairro, com a contagem, a pior condição e o nome do bairro. Os pontos de
    iluminação pública nunca são agrupados: vêm um a um a partir do zoom 15 e, antes dele, o tile
    é vazio.
    """
    definicao = CAMADAS.get(camada)
    if definicao is None:
        raise NotFound("Camada desconhecida.")
    if not request.user.tem_permissao(definicao["permissao"]):
        raise PermissionDenied()
    if not (0 <= z <= 22 and 0 <= x < 2**z and 0 <= y < 2**z):
        raise NotFound("Tile fora do intervalo.")

    area = area_do_escopo(request.user)
    if area is None or (camada == "iluminacao" and z < ZOOM_ILUMINACAO):
        return HttpResponse(b"", content_type=TIPO_MVT)

    # Só árvores e ocorrências têm dimensão temporal; as demais camadas ignoram `ate`.
    periodo = (
        tempo.periodo_da_requisicao(request.query_params)
        if camada in ("arvores", "ocorrencias")
        else None
    )
    if periodo is None:
        extra, valores = definicao["filtros"](request.query_params)
    else:
        extra, valores = definicao["filtros"](request.query_params, periodo)
    parametros = {"z": z, "x": x, "y": y, "area": area.ewkb, **valores}
    if periodo is not None:
        parametros.update(periodo.parametros())
    base = _base_da_camada(definicao, periodo) + extra
    if camada == "arvores" and z < ZOOM_AGRUPA_BAIRRO:
        # SQL montado só a partir de constantes deste módulo; valores vão como parâmetros.
        parametros["celula"] = tamanho_da_celula(z)
        parametros["camada"] = camada
        with connection.cursor() as cursor:
            cursor.execute(_sql_arvores_por_bairro(definicao, extra, periodo), parametros)
            dados = cursor.fetchone()[0]
        resposta = HttpResponse(bytes(dados or b""), content_type=TIPO_MVT)
        resposta["Cache-Control"] = "private, max-age=30"
        return resposta
    if z >= ZOOM_INDIVIDUAL or camada == "iluminacao":
        # SQL montado só a partir de constantes deste módulo; valores vão como parâmetros.
        selecao = f"""
            SELECT {definicao["propriedades"]}, 1 AS quantidade,
                   ST_AsMVTGeom(g3857, env.g, 4096, 64, true) AS geom
              FROM base, env
        """
    else:
        parametros["celula"] = tamanho_da_celula(z)
        # Célula com um único registro leva as mesmas propriedades da feição
        # individual, para a simbologia não depender do zoom.
        individuais = ",\n                   ".join(
            f"CASE WHEN count(*) = 1 THEN (array_agg({p}))[1] END AS {p}"
            for p in (c.strip() for c in definicao["propriedades"].split(","))
        )
        # Grupos de árvores indicam a pior condição contida (morta > ruim > regular > boa
        # > nao_avaliada), para o anel do grupo não esconder concentrações de problema.
        if camada == "arvores":
            individuais += f",\n                   {SQL_PIOR_CONDICAO} AS pior_condicao"
        selecao = f"""
            SELECT count(*)::int AS quantidade,
                   {individuais},
                   ST_AsMVTGeom(ST_Centroid(ST_Collect(g3857)), env.g, 4096, 64, true) AS geom
              FROM base, env
             GROUP BY ST_SnapToGrid(g3857, %(celula)s), env.g
        """
    sql = f"""
        WITH env AS (SELECT ST_TileEnvelope(%(z)s, %(x)s, %(y)s) AS g),
             base AS ({base})
        SELECT ST_AsMVT(t, %(camada)s, 4096, 'geom') FROM ({selecao}) t
    """
    parametros["camada"] = camada
    with connection.cursor() as cursor:
        cursor.execute(sql, parametros)
        dados = cursor.fetchone()[0]
    resposta = HttpResponse(bytes(dados or b""), content_type=TIPO_MVT)
    resposta["Cache-Control"] = "private, max-age=30"
    return resposta


ResultadoBusca = inline_serializer(
    "ResultadoBusca",
    many=True,
    fields={
        "tipo": serializers.ChoiceField(
            choices=["arvore", "ocorrencia", "territorio", "coordenada"]
        ),
        "id": serializers.CharField(allow_null=True),
        "rotulo": serializers.CharField(),
        "descricao": serializers.CharField(),
        "localizacao": serializers.DictField(allow_null=True),
        "limites": serializers.ListField(child=serializers.FloatField(), allow_null=True),
        "subtipo": serializers.CharField(
            required=False, help_text="Só nos territórios: municipio, regional ou bairro."
        ),
        "deteccao": serializers.CharField(
            required=False,
            allow_blank=True,
            help_text='Só nas árvores: "satelite" ou "video_rua" se vieram de detecção '
            "automática (selo de origem); vazio nas demais.",
        ),
        "confirmada": serializers.BooleanField(
            required=False, help_text="Só nas árvores: falso = detectada e ainda sem revisão."
        ),
    },
)

COORDENADA = re.compile(r"^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$")


def _rotulo_coordenada(lat: float, lon: float) -> str:
    """Mesmo formato da interface web: "lat −3,746602 · lon −38,540452"."""

    def parte(v: float) -> str:
        return f"{v:.6f}".replace(".", ",").replace("-", "\u2212")

    return f"lat {parte(lat)} \u00b7 lon {parte(lon)}"


@extend_schema(
    operation_id="mapa_busca",
    parameters=[OpenApiParameter("q", str, required=True)],
    responses=ResultadoBusca,
)
@api_view(["GET"])
def busca(request: Request):
    """Busca global por identificador, endereço, bairro ou coordenada (RF-SHELL-003)."""
    termo = (request.query_params.get("q") or "").strip()
    usuario = request.user
    resultados: list[dict] = []
    if len(termo) < 2:
        return Response(resultados)

    if m := COORDENADA.match(termo):
        lat, lon = (float(v.replace(",", ".")) for v in m.groups())
        if abs(lat) <= 90 and abs(lon) <= 180:
            resultados.append(
                {
                    "tipo": "coordenada",
                    "id": None,
                    "rotulo": _rotulo_coordenada(lat, lon),
                    "descricao": "Coordenada (latitude, longitude)",
                    "localizacao": {"longitude": lon, "latitude": lat},
                    "limites": None,
                }
            )

    if usuario.tem_permissao("inventario.ler"):
        arvores = filtrar_arvores(
            filtrar_por_escopo(Arvore.objects.select_related("especie", "bairro"), usuario),
            {"busca": termo},
        )[:5]
        for a in arvores:
            resultados.append(
                {
                    "tipo": "arvore",
                    "id": str(a.id),
                    "rotulo": a.codigo,
                    "descricao": " · ".join(
                        filter(
                            None,
                            [
                                a.especie.nome_cientifico
                                if a.especie
                                else "Espécie não identificada",
                                a.endereco,
                                a.bairro.nome if a.bairro else "",
                            ],
                        )
                    ),
                    "localizacao": {"longitude": a.geom.x, "latitude": a.geom.y}
                    if a.geom
                    else None,
                    "limites": None,
                    "deteccao": a.deteccao,
                    "confirmada": a.confirmada,
                }
            )

    if usuario.tem_permissao("ocorrencias.ler") and (
        m := re.fullmatch(r"(?i)(?:oco-?)?0*(\d+)", termo)
    ):
        for o in filtrar_por_escopo(Ocorrencia.objects.select_related("tipo"), usuario).filter(
            numero=int(m.group(1))
        )[:3]:
            resultados.append(
                {
                    "tipo": "ocorrencia",
                    "id": str(o.id),
                    "rotulo": o.codigo,
                    "descricao": f"{o.tipo.nome} · {o.get_estado_display()}",
                    "localizacao": {"longitude": o.geom.x, "latitude": o.geom.y},
                    "limites": None,
                }
            )

    for t in Territorio.objects.filter(nome__icontains=termo).order_by("tipo", "nome")[:5]:
        resultados.append(
            {
                "tipo": "territorio",
                "id": str(t.id),
                "rotulo": t.nome,
                "descricao": t.get_tipo_display(),
                "localizacao": None,
                "limites": list(t.geom.extent),
                "subtipo": t.tipo,
            }
        )
    return Response(resultados)


@extend_schema(
    operation_id="mapa_camadas",
    responses=inline_serializer(
        "Camadas",
        {
            "territorios": serializers.ListField(child=serializers.DictField()),
            "areas_verdes": serializers.ListField(child=serializers.DictField()),
            "iluminacao": serializers.DictField(allow_null=True),
            "populacao": serializers.ListField(
                child=serializers.DictField(),
                help_text="Fontes de população, renda e IDH: versão em uso, última conferência e "
                "se estão desatualizadas ou com falha.",
            ),
            "arvores": serializers.DictField(allow_null=True),
            "ocorrencias": serializers.DictField(allow_null=True),
            "limites_escopo": serializers.ListField(
                child=serializers.FloatField(), allow_null=True
            ),
        },
    ),
)
@api_view(["GET"])
def camadas(request: Request):
    """Fonte, data e disponibilidade de cada camada (RF-MAPA-004/006)."""
    usuario = request.user
    territorios = [
        {
            "tipo": linha["tipo"],
            "quantidade": linha["quantidade"],
            "fontes": sorted(
                set(Territorio.objects.filter(tipo=linha["tipo"]).values_list("fonte", flat=True))
            ),
            "data_referencia_mais_antiga": linha["referencia"],
            "ingerido_em": linha["ingerido"],
        }
        for linha in Territorio.objects.values("tipo").annotate(
            quantidade=Count("id"), referencia=Min("data_referencia"), ingerido=Max("ingerido_em")
        )
    ]
    areas_verdes = [
        {
            "tipo": linha["tipo"],
            "quantidade": linha["quantidade"],
            "fontes": sorted(
                set(AreaVerde.objects.filter(tipo=linha["tipo"]).values_list("fonte", flat=True))
            ),
            "licencas": sorted(
                set(AreaVerde.objects.filter(tipo=linha["tipo"]).values_list("licenca", flat=True))
                - {""}
            ),
            "data_referencia_mais_antiga": linha["referencia"],
            "ingerido_em": linha["ingerido"],
            # Só as praças têm subtipo (areninha, calçadão...): quantidade de cada um.
            "subtipos": {
                sub: n
                for sub, n in AreaVerde.objects.filter(tipo=linha["tipo"])
                .exclude(subtipo="")
                .order_by()
                .values_list("subtipo")
                .annotate(n=Count("id"))
            },
        }
        for linha in AreaVerde.objects.order_by()
        .values("tipo")
        .annotate(
            quantidade=Count("id"), referencia=Min("data_referencia"), ingerido=Max("ingerido_em")
        )
    ]
    arvores = ocorrencias = None
    if usuario.tem_permissao("mapa.ler"):
        visiveis = filtrar_por_escopo(
            Arvore.objects.filter(situacao=SituacaoArvore.ATIVA), usuario, incluir_sem_geom=True
        )
        arvores = visiveis.aggregate(
            total=Count("id"),
            sem_localizacao=Count("id", filter=Q(geom__isnull=True)),
            atualizado_em=Max("atualizado_em"),
        )
    if usuario.tem_permissao("ocorrencias.ler"):
        ocorrencias = filtrar_por_escopo(Ocorrencia.objects.all(), usuario).aggregate(
            abertas=Count("id", filter=~Q(estado__in=ESTADOS_FINAIS)),
            atualizado_em=Max("atualizado_em"),
        )
    area = area_do_escopo(usuario)
    return Response(
        {
            "territorios": territorios,
            "areas_verdes": areas_verdes,
            "iluminacao": resumo_da_iluminacao(),
            "populacao": situacao_das_fontes(),
            "arvores": arvores,
            "ocorrencias": ocorrencias,
            "limites_escopo": list(area.extent) if area else None,
        }
    )


@extend_schema(
    operation_id="mapa_alertas",
    parameters=[
        OpenApiParameter("bairro", str),
        OpenApiParameter("ate", str, description=PARAM_ATE),
        OpenApiParameter("desde", str, description=PARAM_DESDE),
    ],
    responses={(200, "application/geo+json"): OpenApiTypes.OBJECT},
)
@api_view(["GET"])
def alertas(request: Request):
    """Alertas ambientais em aberto como GeoJSON (polígonos e pontos), com escopo."""
    from itree.alertas.views import alertas_geojson

    if not request.user.tem_permissao("alertas.ler"):
        raise PermissionDenied()
    return Response(alertas_geojson(request.user, request.query_params))


@extend_schema(
    operation_id="mapa_supressao_anual",
    parameters=[OpenApiParameter("precisao", int, description="Casas decimais (padrão 5).")],
    responses={(200, "application/geo+json"): OpenApiTypes.OBJECT},
)
@api_view(["GET"])
def supressao_anual(request: Request):
    """Supressão anual do PRODES Caatinga (INPE) como GeoJSON: camada de referência histórica.

    Não são alertas: o PRODES é anual, de escala regional (polígonos de cerca de 1 ha ou mais)
    e não prova irregularidade. A resposta traz fonte, licença, escala e o intervalo de anos.
    """
    import json

    from django.contrib.gis.db.models.functions import AsGeoJSON

    from itree.alertas.escopo import filtrar_supressao_por_escopo
    from itree.alertas.models import SupressaoAnual
    from itree.alertas.prodes import ESCALA

    if not request.user.tem_permissao("alertas.ler"):
        raise PermissionDenied()
    try:
        precisao = min(max(int(request.query_params.get("precisao", 5)), 1), 8)
    except ValueError:
        precisao = 5
    qs = filtrar_supressao_por_escopo(SupressaoAnual.objects.all(), request.user)
    resumo = qs.aggregate(
        anos_min=Min("ano"), anos_max=Max("ano"), total=Count("id"), ingerido_em=Max("ingerido_em")
    )
    fonte = qs.values("fonte", "fonte_url", "licenca").first() or {}
    feicoes = [
        {
            "type": "Feature",
            "id": str(s.id),
            "geometry": json.loads(s.g),
            "properties": {
                "ano": s.ano,
                "data_imagem": s.data_imagem.isoformat(),
                "area_ha": s.area_ha,
                "satelite": s.satelite,
            },
        }
        for s in qs.annotate(g=AsGeoJSON("geom", precision=precisao)).order_by("ano")
    ]
    return Response(
        {
            "type": "FeatureCollection",
            "features": feicoes,
            "proveniencia": {
                "nome": "Supressão anual (PRODES Caatinga)",
                "fonte": fonte.get("fonte", ""),
                "fonte_url": fonte.get("fonte_url", ""),
                "licenca": fonte.get("licenca", ""),
                "ingerido_em": resumo["ingerido_em"],
                "ano_inicial": resumo["anos_min"],
                "ano_final": resumo["anos_max"],
                "quantidade": resumo["total"],
                "escala": ESCALA,
            },
        }
    )


def _mes_texto(d) -> str:
    return f"{d.year:04d}-{d.month:02d}"


@extend_schema(
    operation_id="mapa_serie_temporal",
    parameters=[OpenApiParameter("bairro", str)],
    responses=inline_serializer(
        "SerieTemporalMapa",
        {
            "primeiro_mes": serializers.CharField(
                allow_null=True, help_text="AAAA-MM do primeiro dado; nulo quando não há dado."
            ),
            "ultimo_mes": serializers.CharField(help_text="AAAA-MM do mês atual."),
            "meses": serializers.ListField(
                child=serializers.DictField(),
                help_text="Do primeiro ao último mês, sem lacunas: `mes` (AAAA-MM), "
                "`arvores` (cadastradas), `ocorrencias` (registradas) e `alertas` (detectados). "
                "Uma série ausente (sem permissão) vem como nula.",
            ),
        },
    ),
)
@api_view(["GET"])
def serie_temporal(request: Request):
    """Séries mensais leves para o histograma da linha do tempo, com o escopo do usuário.

    Cada série só aparece para quem pode ler a camada correspondente. As árvores contam por data de
    cadastro no iTree (`criado_em`), não por data de plantio.
    """
    from django.db.models.functions import TruncMonth
    from django.utils import timezone

    from itree.alertas.escopo import filtrar_alertas_por_escopo
    from itree.alertas.models import AlertaAmbiental
    from itree.alertas.views import filtrar_por_bairro

    usuario = request.user
    bairro = request.query_params.get("bairro")
    series: dict[str, dict[str, int]] = {}

    def somar(nome: str, qs, campo: str) -> None:
        linhas = (
            qs.order_by()
            .annotate(mes=TruncMonth(campo))
            .values("mes")
            .annotate(n=Count("id"))
            .values_list("mes", "n")
        )
        series[nome] = {_mes_texto(mes): n for mes, n in linhas if mes}

    if usuario.tem_permissao("mapa.ler"):
        qs = filtrar_por_escopo(Arvore.objects.exclude(geom__isnull=True), usuario)
        if bairro:
            qs = qs.filter(bairro_id=uuid_do_parametro(bairro, "bairro"))
        somar("arvores", qs, "criado_em")
    if usuario.tem_permissao("ocorrencias.ler"):
        qs = filtrar_por_escopo(Ocorrencia.objects.all(), usuario)
        if bairro:
            qs = qs.filter(bairro_id=uuid_do_parametro(bairro, "bairro"))
        somar("ocorrencias", qs, "criado_em")
    if usuario.tem_permissao("alertas.ler"):
        qs = filtrar_por_bairro(
            filtrar_alertas_por_escopo(AlertaAmbiental.objects.all(), usuario), bairro
        )
        somar("alertas", qs, "data_deteccao")

    hoje = timezone.localdate()
    atual = _mes_texto(hoje)
    existentes = sorted({m for s in series.values() for m in s})
    primeiro = existentes[0] if existentes else None
    meses = []
    if primeiro:
        ano, mes = int(primeiro[:4]), int(primeiro[5:])
        while f"{ano:04d}-{mes:02d}" <= atual:
            chave = f"{ano:04d}-{mes:02d}"
            meses.append(
                {
                    "mes": chave,
                    "arvores": series["arvores"].get(chave, 0) if "arvores" in series else None,
                    "ocorrencias": series["ocorrencias"].get(chave, 0)
                    if "ocorrencias" in series
                    else None,
                    "alertas": series["alertas"].get(chave, 0) if "alertas" in series else None,
                }
            )
            ano, mes = (ano + 1, 1) if mes == 12 else (ano, mes + 1)
    resposta = Response({"primeiro_mes": primeiro, "ultimo_mes": atual, "meses": meses})
    resposta["Cache-Control"] = "private, max-age=60"
    return resposta


@extend_schema(
    operation_id="mapa_situacao_na_data",
    parameters=[
        OpenApiParameter("ate", str, required=True, description=PARAM_ATE),
        OpenApiParameter("desde", str, description=PARAM_DESDE),
        OpenApiParameter("bairro", str),
    ],
    responses=inline_serializer(
        "SituacaoNaData",
        {
            "arvores": serializers.IntegerField(allow_null=True),
            "ocorrencias_abertas": serializers.IntegerField(allow_null=True),
            "alertas": serializers.IntegerField(allow_null=True),
        },
    ),
)
@api_view(["GET"])
def situacao_na_data(request: Request):
    """Contagens do período da linha do tempo (árvores, ocorrências abertas e alertas), com o mesmo
    escopo e as mesmas regras dos tiles. A contagem de uma camada que o usuário não pode ler vem
    nula."""
    from itree.alertas.escopo import filtrar_alertas_por_escopo
    from itree.alertas.models import AlertaAmbiental
    from itree.alertas.views import filtrar_por_bairro

    if not request.query_params.get("ate"):
        raise ValidationError({"ate": "Informe o mês (AAAA-MM)."})
    periodo = tempo.periodo_da_requisicao(request.query_params)
    usuario = request.user
    area = area_do_escopo(usuario)
    bairro = request.query_params.get("bairro")
    parametros: dict = {**periodo.parametros()}
    if area is not None:
        parametros["area"] = area.ewkb
    filtro_bairro = {"arvores": "", "ocorrencias": ""}
    if bairro:
        parametros["bairro"] = str(uuid_do_parametro(bairro, "bairro"))
        filtro_bairro = {k: f" AND {k[0]}.bairro_id = %(bairro)s" for k in filtro_bairro}

    def contar(sql: str) -> int:
        with connection.cursor() as cursor:
            cursor.execute(sql, parametros)
            return cursor.fetchone()[0]

    aberta = tempo.ocorrencia_aberta_na_data(periodo)
    arvores = ocorrencias = alertas = None
    if usuario.tem_permissao("mapa.ler"):
        arvores = (
            contar(
                f"""SELECT count(*) FROM inventario_arvore a
                     WHERE a.geom IS NOT NULL AND ST_Intersects(a.geom, ST_GeomFromEWKB(%(area)s))
                       AND {tempo.arvore_na_data(periodo)}{filtro_bairro["arvores"]}"""
            )
            if area is not None
            else 0
        )
    if usuario.tem_permissao("ocorrencias.ler"):
        ocorrencias = (
            contar(
                f"""SELECT count(*) FROM ocorrencias_ocorrencia o
                     WHERE ST_Intersects(o.geom, ST_GeomFromEWKB(%(area)s))
                       AND {aberta}{filtro_bairro["ocorrencias"]}"""
            )
            if area is not None
            else 0
        )
    if usuario.tem_permissao("alertas.ler"):
        qs = AlertaAmbiental.objects.filter(
            data_deteccao__gte=periodo.inicio_dos_alertas, data_deteccao__lt=periodo.fim
        )
        alertas = filtrar_por_bairro(filtrar_alertas_por_escopo(qs, usuario), bairro).count()
    return Response({"arvores": arvores, "ocorrencias_abertas": ocorrencias, "alertas": alertas})
