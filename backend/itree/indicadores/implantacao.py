"""Primeiros passos da implantação (G-03): o que falta configurar antes do uso.

O checklist é calculado no servidor, só para quem administra catálogos e integrações,
e não depende de decisão pendente: cada passo olha para dados que já existem no
sistema (territórios, espécies, equipes, lotes de importação e fontes configuradas).
"""

from django.conf import settings
from django.db.models import Count
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.request import Request
from rest_framework.response import Response

from itree.contas.acesso import requer
from itree.contas.models import Equipe
from itree.contas.permissoes import Permissao
from itree.inventario.models import Especie, EstadoLote, LoteImportacao
from itree.territorio.models import Territorio


def _plural(n: int, singular: str, plural: str) -> str:
    return f"{n} {singular if n == 1 else plural}"


def passos() -> list[dict]:
    territorios = Territorio.objects.count()
    especies = Especie.objects.filter(ativa=True).count()
    equipes = Equipe.objects.filter(ativa=True).annotate(
        n_membros=Count("membros", distinct=True), n_territorios=Count("territorios", distinct=True)
    )
    ativas = equipes.count()
    completas = equipes.filter(n_membros__gt=0, n_territorios__gt=0).count()
    lotes = LoteImportacao.objects.filter(estado=EstadoLote.CONFIRMADO).count()
    fontes = len(settings.ALERTAS_FONTES or {})

    if ativas == 0:
        detalhe_equipes = "Nenhuma equipe ativa."
    elif completas == ativas:
        detalhe_equipes = f"{_plural(completas, 'equipe completa', 'equipes completas')}."
    else:
        detalhe_equipes = (
            f"{completas} de {_plural(ativas, 'equipe ativa', 'equipes ativas')} "
            "com membros e território."
        )

    return [
        {
            "id": "territorios",
            "titulo": "Importar os territórios",
            "descricao": (
                "Município e bairros, com fonte e data. Definem o escopo de cada pessoa "
                "e os filtros por bairro."
            ),
            "concluido": territorios > 0,
            "detalhe": (
                f"{_plural(territorios, 'território importado', 'territórios importados')}."
                if territorios
                else "Nenhum território importado."
            ),
            "link": "/administracao/territorios",
        },
        {
            "id": "especies",
            "titulo": "Montar o catálogo de espécies",
            "descricao": "As espécies que podem ser escolhidas no cadastro das árvores.",
            "concluido": especies > 0,
            "detalhe": (
                f"{_plural(especies, 'espécie ativa', 'espécies ativas')}."
                if especies
                else "Nenhuma espécie no catálogo."
            ),
            "link": "/inventario/especies",
        },
        {
            "id": "equipes",
            "titulo": "Cadastrar equipes com membros e território",
            "descricao": "Sem membros e território, as tarefas não chegam a quem executa.",
            "concluido": completas > 0,
            "detalhe": detalhe_equipes,
            "link": "/administracao/equipes",
        },
        {
            "id": "inventario",
            "titulo": "Importar o inventário",
            "descricao": "A primeira importação confirmada de árvores, com fonte e data.",
            "concluido": lotes > 0,
            "detalhe": (
                f"{_plural(lotes, 'importação confirmada', 'importações confirmadas')}."
                if lotes
                else "Nenhuma importação confirmada."
            ),
            "link": "/inventario/importacoes",
        },
        {
            "id": "fontes",
            "titulo": "Configurar as fontes externas",
            "descricao": "A coleta automática de alertas: focos de calor e desmatamento.",
            "concluido": fontes > 0,
            "detalhe": (
                f"{_plural(fontes, 'fonte configurada', 'fontes configuradas')}."
                if fontes
                else "Nenhuma fonte com coleta automática."
            ),
            "link": "/administracao/integracoes",
        },
    ]


class PassoSerializer(serializers.Serializer):
    id = serializers.CharField()
    titulo = serializers.CharField()
    descricao = serializers.CharField()
    concluido = serializers.BooleanField()
    detalhe = serializers.CharField()
    link = serializers.CharField(help_text="Caminho da tela onde o passo é feito.")


class PrimeirosPassosSerializer(serializers.Serializer):
    completo = serializers.BooleanField()
    passos = PassoSerializer(many=True)


@extend_schema(operation_id="implantacao_primeiros_passos", responses=PrimeirosPassosSerializer)
@api_view(["GET"])
@permission_classes([requer(Permissao.ADMIN_CONFIGURACAO)])
def primeiros_passos(request: Request) -> Response:
    """Checklist "Primeiros passos" da implantação; `completo` esconde o cartão na visão geral."""
    lista = passos()
    return Response({"completo": all(p["concluido"] for p in lista), "passos": lista})
