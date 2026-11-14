"""Cadastra conectores de exemplo, **inativos**, para o administrador revisar e ativar.

    manage.py criar_conectores_exemplo

Hoje há um: os atendimentos do Plano de Arborização, do Fortaleza em Mapas (camada 534),
como camada de referência. É contexto para o mapa: não é inventário (DP-18) e não cria árvores.
Reexecutar não altera um conector que já existe.
"""

from django.core.management.base import BaseCommand

from itree.conectores.models import (
    Conector,
    DestinoConector,
    Periodicidade,
    TipoConector,
)

EXEMPLOS = [
    {
        "nome": "Atendimentos do Plano de Arborização",
        "tipo": TipoConector.GEOJSON_URL,
        "url": "https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=534",
        # O "id" do GeoServer muda a cada leitura; a propriedade "id" é a estável.
        "parametros": {"campo_id": "id"},
        "destino": DestinoConector.CAMADA_REFERENCIA,
        "periodicidade": Periodicidade.MENSAL,
        "ativo": False,
        "orgao": "Prefeitura de Fortaleza, SEUMA (Fortaleza em Mapas)",
        "licenca": "Não declarada pela fonte; condições de uso em definição pela prefeitura. "
        "Citar: Prefeitura de Fortaleza, Fortaleza em Mapas.",
        "url_origem": "https://mapas.fortaleza.ce.gov.br/",
        "cor": "#7a4fb5",
        "rotulos": {
            "name": "Endereço",
            "folders": "Período",
            "description": "Atendimento",
            "fonte": "Fonte",
            "ano_ref": "Ano de referência",
            "id": "Código na fonte",
        },
    }
]


class Command(BaseCommand):
    help = "Cadastra conectores de exemplo, inativos."

    def handle(self, *args, **opts):
        for exemplo in EXEMPLOS:
            _, criado = Conector.objects.get_or_create(nome=exemplo["nome"], defaults=exemplo)
            self.stdout.write(
                f"{'Criado' if criado else 'Já existia'} (inativo): {exemplo['nome']}"
            )
