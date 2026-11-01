"""Mapa (W-02): vector tiles com escopo territorial, busca e metadados de camadas."""

import re

from django.db import connection
from django.db.models import Count, Max, Min, Q
from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response

from itree.contas.acesso import area_do_escopo, filtrar_por_escopo
from itree.core.parametros import uuid_do_parametro
from itree.inventario.models import Arvore, SituacaoArvore
from itree.inventario.views import filtrar_arvores
from itree.ocorrencias.models import ESTADOS_FINAIS, Ocorrencia
from itree.territorio.models import Territorio

TIPO_MVT = "application/vnd.mapbox-vector-tile"
ZOOM_INDIVIDUAL = 16
CIRCUNFERENCIA_3857 = 40075016.68557849


def _filtros_arvores(params) -> tuple[str, dict]:
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
        clausulas.append(
            "(a.ultima_inspecao_em IS NULL"
            " OR a.ultima_inspecao_em < now() - make_interval(days => %(dias)s))"
        )
    if condicao := params.get("condicao_aparente"):
        clausulas.append("a.condicao_aparente = %(condicao)s")
        valores["condicao"] = "" if condicao == "sem" else condicao
    return "".join(f" AND {c}" for c in clausulas), valores


def _filtros_ocorrencias(params) -> tuple[str, dict]:
    clausulas, valores = [], {}
    estado = params.get("estado", "abertas")
    if estado == "abertas":
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
    return "".join(f" AND {c}" for c in clausulas), valores


CAMADAS = {
    "arvores": {
        "permissao": "mapa.ler",
        "filtros": _filtros_arvores,
        "base": """
            SELECT a.id::text AS id, a.numero, a.especie_estado, a.localizacao_origem,
                   COALESCE(NULLIF(a.condicao_aparente, ''), 'nao_avaliada') AS condicao,
                   COALESCE(a.precisao_m, -1) AS precisao_m,
                   COALESCE(e.nome_cientifico, '') AS especie,
                   ST_Transform(a.geom, 3857) AS g3857
              FROM inventario_arvore a
              LEFT JOIN inventario_especie e ON e.id = a.especie_id, env
             WHERE a.situacao = 'ativa' AND a.geom IS NOT NULL
               AND a.geom && ST_Transform(env.g, 4326)
               AND ST_Intersects(a.geom, ST_GeomFromEWKB(%(area)s))
        """,
        "propriedades": (
            "id, numero, especie_estado, localizacao_origem, condicao, precisao_m, especie"
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
        "filtros": lambda params: (" AND t.estado NOT IN ('concluida', 'cancelada')", {}),
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
}


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
    ],
    responses={(200, TIPO_MVT): OpenApiTypes.BINARY},
)
@api_view(["GET"])
def tile(request: Request, camada: str, z: int, x: int, y: int):
    """Vector tile (MVT) da camada, restrito ao escopo do usuário.

    Abaixo do zoom 16, os pontos são agrupados em células com a contagem
    (``quantidade``); a partir dele, cada registro vira uma feição.
    """
    definicao = CAMADAS.get(camada)
    if definicao is None:
        raise NotFound("Camada desconhecida.")
    if not request.user.tem_permissao(definicao["permissao"]):
        raise PermissionDenied()
    if not (0 <= z <= 22 and 0 <= x < 2**z and 0 <= y < 2**z):
        raise NotFound("Tile fora do intervalo.")

    area = area_do_escopo(request.user)
    if area is None:
        return HttpResponse(b"", content_type=TIPO_MVT)

    extra, valores = definicao["filtros"](request.query_params)
    parametros = {"z": z, "x": x, "y": y, "area": area.ewkb, **valores}
    base = definicao["base"] + extra
    if z >= ZOOM_INDIVIDUAL:
        # SQL montado só a partir de constantes deste módulo; valores vão como parâmetros.
        selecao = f"""
            SELECT {definicao["propriedades"]}, 1 AS quantidade,
                   ST_AsMVTGeom(g3857, env.g, 4096, 64, true) AS geom
              FROM base, env
        """
    else:
        parametros["celula"] = CIRCUNFERENCIA_3857 / 2**z / 64
        # Célula com um único registro leva as mesmas propriedades da feição
        # individual, para a simbologia não depender do zoom.
        individuais = ",\n                   ".join(
            f"CASE WHEN count(*) = 1 THEN (array_agg({p}))[1] END AS {p}"
            for p in (c.strip() for c in definicao["propriedades"].split(","))
        )
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
    },
)

COORDENADA = re.compile(r"^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$")


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
                    "rotulo": f"{lat:.6f}, {lon:.6f}",
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
            }
        )
    return Response(resultados)


@extend_schema(
    operation_id="mapa_camadas",
    responses=inline_serializer(
        "Camadas",
        {
            "territorios": serializers.ListField(child=serializers.DictField()),
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
            "arvores": arvores,
            "ocorrencias": ocorrencias,
            "limites_escopo": list(area.extent) if area else None,
        }
    )


@extend_schema(
    operation_id="mapa_alertas", responses={(200, "application/geo+json"): OpenApiTypes.OBJECT}
)
@api_view(["GET"])
def alertas(request: Request):
    """Alertas ambientais em aberto como GeoJSON (polígonos e pontos), com escopo."""
    from itree.alertas.views import alertas_geojson

    if not request.user.tem_permissao("alertas.ler"):
        raise PermissionDenied()
    return Response(alertas_geojson(request.user, request.query_params))
