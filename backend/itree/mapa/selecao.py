"""Seleção por área no mapa (RF-MAPA-022): árvores e ocorrências dentro de um polígono.

A consulta usa os mesmos filtros e o mesmo escopo territorial dos vector tiles,
para que a lista mostre exatamente o que o usuário vê desenhado no mapa.
"""

import json

from django.contrib.gis.gdal import GDALException
from django.contrib.gis.geos import GEOSException, GEOSGeometry
from django.db import connection, models
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response

from itree.contas.acesso import area_do_escopo
from itree.core.parametros import LIMITE_LOTE
from itree.inventario.models import Arvore
from itree.ocorrencias.models import Ocorrencia
from itree.relatorios import views as relatorios

from .views import _CONDICOES_POR_GRAVIDADE, _filtros_arvores, _filtros_ocorrencias

# Itens devolvidos por camada; o total e o resumo cobrem sempre a seleção inteira.
LIMITE_ITENS = 2000
# Cidade de grande porte (Fortaleza tem ~314 km²); acima disso a seleção deixa de ser "uma área".
AREA_MAXIMA_KM2 = 1000
MAXIMO_VERTICES = 1000


class CamadaSelecao(models.TextChoices):
    ARVORES = "arvores", "Árvores"
    OCORRENCIAS = "ocorrencias", "Ocorrências"


CAMADAS_SELECAO = [c.value for c in CamadaSelecao]


class SelecaoEntradaSerializer(serializers.Serializer):
    geometria = serializers.JSONField(help_text="Polígono GeoJSON (EPSG:4326) da área desenhada.")
    filtros = serializers.DictField(
        child=serializers.CharField(allow_blank=True),
        required=False,
        default=dict,
        help_text=(
            "Mesmos filtros dos vector tiles: especie, especie_estado, localizacao_origem, "
            "sem_inspecao_dias, condicao_aparente (árvores); estado, prioridade, tipo "
            "(ocorrências); bairro (ambas)."
        ),
    )
    camadas = serializers.ListField(
        child=serializers.ChoiceField(choices=CamadaSelecao.choices),
        required=False,
        default=lambda: list(CAMADAS_SELECAO),
        help_text="Camadas consultadas (padrão: árvores e ocorrências).",
    )

    def validate_geometria(self, valor):
        if not isinstance(valor, dict) or valor.get("type") != "Polygon":
            raise serializers.ValidationError("Informe um polígono GeoJSON (type = Polygon).")
        try:
            geom = GEOSGeometry(json.dumps(valor), srid=4326)
        except (GEOSException, GDALException, ValueError, TypeError) as exc:
            raise serializers.ValidationError("Geometria GeoJSON inválida.") from exc
        if geom.geom_type != "Polygon" or geom.empty:
            raise serializers.ValidationError("Informe um polígono GeoJSON com área.")
        xmin, ymin, xmax, ymax = geom.extent
        if xmin < -180 or xmax > 180 or ymin < -90 or ymax > 90:
            raise serializers.ValidationError(
                "Coordenadas fora do intervalo (longitude, latitude)."
            )
        if geom.num_coords > MAXIMO_VERTICES:
            raise serializers.ValidationError(f"O polígono passa de {MAXIMO_VERTICES} vértices.")
        if not geom.valid:
            raise serializers.ValidationError(f"Polígono inválido: {geom.valid_reason}.")
        with connection.cursor() as cursor:
            cursor.execute("SELECT ST_Area(ST_GeomFromEWKB(%s)::geography) / 1e6", [geom.ewkb])
            km2 = float(cursor.fetchone()[0])
        if km2 <= 0:
            raise serializers.ValidationError("O polígono não tem área.")
        if km2 > AREA_MAXIMA_KM2:
            raise serializers.ValidationError(
                f"A área tem {km2:.0f} km²; o máximo é {AREA_MAXIMA_KM2} km². "
                "Desenhe uma área menor."
            )
        self.area_km2 = km2
        self.poligono = geom
        return valor


class ItemArvoreSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    codigo = serializers.CharField()
    especie = serializers.CharField()
    condicao = serializers.CharField()
    endereco = serializers.CharField()


class ItemOcorrenciaSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    codigo = serializers.CharField()
    tipo = serializers.CharField()
    estado = serializers.CharField()
    prioridade = serializers.CharField()
    risco_confirmado = serializers.BooleanField()


class SelecaoArvoresSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    por_condicao = serializers.DictField(child=serializers.IntegerField())
    itens = ItemArvoreSerializer(many=True)
    truncado = serializers.BooleanField()


class SelecaoOcorrenciasSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    itens = ItemOcorrenciaSerializer(many=True)
    truncado = serializers.BooleanField()


class SelecaoSaidaSerializer(serializers.Serializer):
    area_km2 = serializers.FloatField()
    limite_itens = serializers.IntegerField()
    limite_tarefas_em_lote = serializers.IntegerField()
    arvores = SelecaoArvoresSerializer(allow_null=True)
    ocorrencias = SelecaoOcorrenciasSerializer(allow_null=True)


_DE_ARVORES = """
      FROM inventario_arvore a
      LEFT JOIN inventario_especie e ON e.id = a.especie_id
     WHERE a.situacao = 'ativa' AND a.geom IS NOT NULL
       AND ST_Intersects(a.geom, ST_GeomFromEWKB(%(escopo)s))
       AND ST_Intersects(a.geom, ST_GeomFromEWKB(%(poligono)s))
"""
_DE_OCORRENCIAS = """
      FROM ocorrencias_ocorrencia o
      JOIN ocorrencias_tipoocorrencia t ON t.id = o.tipo_id
     WHERE ST_Intersects(o.geom, ST_GeomFromEWKB(%(escopo)s))
       AND ST_Intersects(o.geom, ST_GeomFromEWKB(%(poligono)s))
"""
_CONDICAO = "COALESCE(NULLIF(a.condicao_aparente, ''), 'nao_avaliada')"


def _linhas(sql: str, parametros: dict) -> list[dict]:
    with connection.cursor() as cursor:
        cursor.execute(sql, parametros)
        colunas = [c.name for c in cursor.description]
        return [dict(zip(colunas, linha, strict=True)) for linha in cursor.fetchall()]


def _contexto(request: Request, entrada: SelecaoEntradaSerializer, camada: str):
    """Fragmento SQL e parâmetros da camada, já com os filtros do mapa e o escopo do usuário."""
    area = area_do_escopo(request.user)
    filtros = entrada.validated_data["filtros"]
    extra, valores = (_filtros_arvores if camada == "arvores" else _filtros_ocorrencias)(filtros)
    base = (_DE_ARVORES if camada == "arvores" else _DE_OCORRENCIAS) + extra
    parametros = {
        "escopo": area.ewkb if area is not None else None,
        "poligono": entrada.poligono.ewkb,
        **valores,
    }
    return area, base, parametros


def ids_da_selecao(
    request: Request, entrada: SelecaoEntradaSerializer, camada: str, limite: int
) -> list[str]:
    """IDs (por número) dos itens da camada dentro da área e do escopo, até ``limite``."""
    area, base, parametros = _contexto(request, entrada, camada)
    if area is None:
        return []
    alias = "a" if camada == "arvores" else "o"
    linhas = _linhas(
        f"SELECT {alias}.id::text AS id {base} ORDER BY {alias}.numero LIMIT %(limite)s",
        {**parametros, "limite": limite},
    )
    return [linha["id"] for linha in linhas]


def _arvores(request, entrada) -> dict:
    area, base, parametros = _contexto(request, entrada, "arvores")
    vazio = {"total": 0, "por_condicao": {}, "itens": [], "truncado": False}
    if area is None:
        return vazio
    contagem = _linhas(
        f"SELECT {_CONDICAO} AS condicao, count(*)::int AS n {base} GROUP BY 1", parametros
    )
    n_por_condicao = {r["condicao"]: r["n"] for r in contagem}
    # Da menos para a mais grave, sem condições vazias.
    por_condicao = {c: n_por_condicao[c] for c in _CONDICOES_POR_GRAVIDADE if n_por_condicao.get(c)}
    total = sum(por_condicao.values())
    itens = _linhas(
        f"""SELECT a.id::text AS id, a.numero, COALESCE(e.nome_cientifico, '') AS especie,
                   {_CONDICAO} AS condicao, a.endereco {base}
             ORDER BY a.numero LIMIT %(limite)s""",
        {**parametros, "limite": LIMITE_ITENS},
    )
    return {
        "total": total,
        "por_condicao": por_condicao,
        "itens": [
            {
                "id": i["id"],
                "codigo": f"ARV-{i['numero']:06d}" if i["numero"] else "ARV-?",
                "especie": i["especie"],
                "condicao": i["condicao"],
                "endereco": i["endereco"],
            }
            for i in itens
        ],
        "truncado": total > LIMITE_ITENS,
    }


def _ocorrencias(request, entrada) -> dict:
    area, base, parametros = _contexto(request, entrada, "ocorrencias")
    if area is None:
        return {"total": 0, "itens": [], "truncado": False}
    total = _linhas(f"SELECT count(*)::int AS n {base}", parametros)[0]["n"]
    itens = _linhas(
        f"""SELECT o.id::text AS id, o.numero, t.nome AS tipo, o.estado, o.prioridade,
                   o.risco_confirmado {base}
             ORDER BY o.numero LIMIT %(limite)s""",
        {**parametros, "limite": LIMITE_ITENS},
    )
    return {
        "total": total,
        "itens": [
            {
                "id": i["id"],
                "codigo": f"OCO-{i['numero']:06d}" if i["numero"] else "OCO-?",
                "tipo": i["tipo"],
                "estado": i["estado"],
                "prioridade": i["prioridade"],
                "risco_confirmado": i["risco_confirmado"],
            }
            for i in itens
        ],
        "truncado": total > LIMITE_ITENS,
    }


def _permissoes_por_camada(usuario) -> dict[str, bool]:
    # Mesmas permissões das camadas dos vector tiles.
    return {
        "arvores": usuario.tem_permissao("mapa.ler"),
        "ocorrencias": usuario.tem_permissao("ocorrencias.ler"),
    }


@extend_schema(
    operation_id="mapa_selecao",
    request=SelecaoEntradaSerializer,
    responses=SelecaoSaidaSerializer,
)
@api_view(["POST"])
def selecao(request: Request):
    """Árvores e ocorrências dentro de uma área desenhada (RF-MAPA-022).

    Respeita o escopo territorial e as permissões do usuário, e aplica os mesmos
    filtros do mapa. A lista traz até 2000 itens por camada (``truncado`` avisa
    quando há mais); o total e a contagem por condição cobrem a seleção inteira.
    Camada sem permissão volta como ``null``.
    """
    entrada = SelecaoEntradaSerializer(data=request.data)
    entrada.is_valid(raise_exception=True)
    permitidas = _permissoes_por_camada(request.user)
    pedidas = [c for c in entrada.validated_data["camadas"] if permitidas[c]]
    if not pedidas:
        raise PermissionDenied()
    return Response(
        {
            "area_km2": round(entrada.area_km2, 3),
            "limite_itens": LIMITE_ITENS,
            "limite_tarefas_em_lote": LIMITE_LOTE,
            "arvores": _arvores(request, entrada) if "arvores" in pedidas else None,
            "ocorrencias": _ocorrencias(request, entrada) if "ocorrencias" in pedidas else None,
        }
    )


class SelecaoExportarSerializer(SelecaoEntradaSerializer):
    conjunto = serializers.ChoiceField(choices=CamadaSelecao.choices)
    formato = serializers.ChoiceField(choices=list(relatorios.FORMATOS))


@extend_schema(
    operation_id="mapa_selecao_exportar",
    request=SelecaoExportarSerializer,
    responses={(200, "application/octet-stream"): OpenApiTypes.BINARY},
)
@api_view(["POST"])
def selecao_exportar(request: Request):
    """Exporta a seleção por área no mesmo formato das exportações do inventário e das
    ocorrências (CSV, XLSX ou GeoJSON), com metadados e a área desenhada como filtro.
    """
    entrada = SelecaoExportarSerializer(data=request.data)
    entrada.is_valid(raise_exception=True)
    dados = entrada.validated_data
    conjunto, formato = dados["conjunto"], dados["formato"]
    usuario = request.user
    exigidas = {
        "arvores": ("relatorios.exportar", "mapa.ler", "inventario.ler"),
        "ocorrencias": ("relatorios.exportar", "ocorrencias.ler"),
    }[conjunto]
    if not all(usuario.tem_permissao(p) for p in exigidas):
        raise PermissionDenied()
    # Um registro a mais que o limite da exportação indica corte.
    ids = ids_da_selecao(request, entrada, conjunto, relatorios.LIMITE_EXPORTACAO + 1)
    if conjunto == "arvores":
        titulo, _, _ = relatorios.CONJUNTOS["arvores"]
        qs = Arvore.objects.select_related("especie", "bairro").filter(pk__in=ids)
        colunas, registros = relatorios.tabela_arvores(qs)
    else:
        titulo, _, _ = relatorios.CONJUNTOS["ocorrencias"]
        qs = Ocorrencia.objects.select_related("tipo", "bairro", "arvore").filter(pk__in=ids)
        colunas, registros = relatorios.tabela_ocorrencias(qs)
    filtros = {
        "selecao": "area",
        "area_km2": round(entrada.area_km2, 3),
        "geometria": dados["geometria"],
        **dados["filtros"],
    }
    resposta = relatorios.resposta_exportacao(
        usuario, conjunto, f"Seleção por área — {titulo}", formato, filtros, colunas, registros
    )
    return resposta
