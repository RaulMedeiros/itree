"""Bairros que pedem atenção (G-02): ranking dos bairros do escopo por um índice
simples, com cada componente à vista. Critério provisório, até a DP-14 definir
os indicadores oficiais."""

from datetime import date, datetime, timedelta

from django.db.models import Count, IntegerField, OuterRef, Q, QuerySet, Subquery, Value
from django.db.models.functions import Coalesce

from itree.contas.acesso import tem_escopo_municipal
from itree.contas.models import Usuario
from itree.inspecoes.models import CondicaoAparente
from itree.ocorrencias.models import ESTADOS_FINAIS
from itree.territorio.models import Territorio, TipoTerritorio

from . import instantaneos

LIMITE = 5
JANELA_INSPECAO_DIAS = 365

# Peso de cada componente no índice: o que é risco confirmado pesa mais que o que
# é só pendência de cadastro. Visível na resposta e em "Como é calculado".
PESOS = {"risco_confirmado": 10, "atrasadas": 5, "ruins_ou_mortas": 2, "sem_inspecao": 1}
ROTULOS = {
    "risco_confirmado": "Ocorrências abertas com risco confirmado",
    "atrasadas": "Ocorrências atrasadas",
    "ruins_ou_mortas": "Árvores com condição ruim ou aparentemente morta",
    "sem_inspecao": "Árvores sem inspeção há mais de 12 meses",
}
DEFINICAO = (
    "Os 5 bairros do seu escopo com maior índice de atenção. O índice soma, com pesos, "
    "ocorrências abertas com risco confirmado, ocorrências abertas com prazo vencido, "
    "árvores válidas com condição aparente ruim ou aparentemente morta e árvores válidas "
    "sem inspeção validada nos últimos 12 meses (inclui as nunca inspecionadas). "
    "Bairros com índice zero não aparecem. Critério provisório, sujeito à DP-14; "
    "a ordem não indica culpa nem irregularidade."
)


def bairros_do_escopo(usuario: Usuario) -> QuerySet[Territorio]:
    """Bairros que são (ou estão dentro de) um território do escopo do usuário."""
    bairros = Territorio.objects.filter(tipo=TipoTerritorio.BAIRRO)
    if tem_escopo_municipal(usuario):
        return bairros
    ids = set(Territorio.objects.filter(usuarios=usuario).values_list("pk", flat=True))
    if not ids:
        return bairros.none()
    pais = dict(Territorio.objects.values_list("pk", "pai_id"))

    def dentro(pk) -> bool:
        while pk is not None:
            if pk in ids:
                return True
            pk = pais.get(pk)
        return False

    return bairros.filter(pk__in=[pk for pk in pais if dentro(pk)])


def _contagem(qs: QuerySet, campo_geom: str = "geom"):
    """Subconsulta: quantos registros de ``qs`` intersectam o bairro da linha externa."""
    contagem = (
        qs.filter(**{f"{campo_geom}__intersects": OuterRef("geom")})
        .order_by()
        .annotate(_grupo=Value(1))
        .values("_grupo")
        .annotate(n=Count("pk"))
        .values("n")
    )
    return Coalesce(Subquery(contagem, output_field=IntegerField()), 0)


def indice(componentes: dict[str, int]) -> int:
    return sum(PESOS[c] * n for c, n in componentes.items())


def ranking(
    usuario: Usuario,
    arvores: QuerySet,
    ocorrencias: QuerySet,
    *,
    hoje: date,
    agora: datetime,
) -> dict:
    """``arvores`` e ``ocorrencias`` já vêm restritas ao escopo do usuário."""
    validas = instantaneos.arvores_validas(arvores)
    abertas = ocorrencias.exclude(estado__in=ESTADOS_FINAIS)
    sem_inspecao = validas.filter(
        Q(ultima_inspecao_em__isnull=True)
        | Q(ultima_inspecao_em__lt=agora - timedelta(days=JANELA_INSPECAO_DIAS))
    )
    linhas = bairros_do_escopo(usuario).annotate(
        risco_confirmado=_contagem(abertas.filter(risco_confirmado=True)),
        atrasadas=_contagem(abertas.filter(prazo__lt=hoje)),
        ruins_ou_mortas=_contagem(
            validas.filter(condicao_aparente__in=[CondicaoAparente.RUIM, CondicaoAparente.MORTA])
        ),
        sem_inspecao=_contagem(sem_inspecao),
    )
    itens = []
    for b in linhas:
        componentes = {c: getattr(b, c) for c in PESOS}
        total = indice(componentes)
        if total:
            itens.append(
                {
                    "id": b.pk,
                    "nome": b.nome,
                    "indice": total,
                    "componentes": [
                        {"id": c, "rotulo": ROTULOS[c], "quantidade": n, "peso": PESOS[c]}
                        for c, n in componentes.items()
                    ],
                    "link": {"pagina": "/mapa", "filtros": {"destaque": str(b.pk)}},
                }
            )
    itens.sort(key=lambda i: (-i["indice"], i["nome"]))
    return {
        "titulo": "Bairros que pedem atenção",
        "definicao": DEFINICAO,
        "formula": " + ".join(f"{PESOS[c]} × {ROTULOS[c].lower()}" for c in PESOS),
        "itens": itens[:LIMITE],
    }
