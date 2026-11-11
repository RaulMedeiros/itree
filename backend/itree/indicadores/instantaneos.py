"""Indicadores instantâneos da visão geral (M-11): cálculo reutilizável, registro
diário por território e leitura da série e do valor anterior no escopo do usuário.

Cada instantâneo é um par (numerador, denominador); contagens têm denominador
``None``. A série e o valor anterior nunca são calculados na hora: vêm dos
registros feitos por ``registrar``.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta

from django.db.models import Q, QuerySet
from django.utils import timezone

from itree.contas.models import Usuario
from itree.inspecoes.models import EstadoInspecao, Inspecao
from itree.inventario.models import Arvore, EstadoEspecie, Medida, SituacaoArvore, TipoMedida
from itree.ocorrencias.models import ESTADOS_FINAIS, Ocorrencia
from itree.tarefas.models import ESTADOS_FINAIS_TAREFA, Tarefa, TipoTarefa
from itree.territorio.models import Territorio, TipoTerritorio

from .models import RegistroIndicador

# Pontos da série: o último registro de cada mês, nos 365 dias até o fim do período.
JANELA_SERIE_DIAS = 365
MAX_PONTOS_SERIE = 12

Instantaneos = dict[str, tuple[int, int | None]]


def arvores_validas(arvores: QuerySet) -> QuerySet:
    return arvores.filter(situacao=SituacaoArvore.ATIVA, geom__isnull=False).exclude(
        localizacao_origem=""
    )


def calcular(
    arvores: QuerySet,
    ocorrencias: QuerySet,
    inspecoes: QuerySet,
    tarefas: QuerySet,
    *,
    hoje: date,
    agora: datetime,
) -> Instantaneos:
    """Instantâneos de um escopo, dado pelos querysets já restritos a ele."""
    validas = arvores_validas(arvores)
    total = validas.count()
    com_especie = validas.filter(especie_estado=EstadoEspecie.CONFIRMADA).count()
    com_medidas = validas.filter(
        pk__in=Medida.objects.filter(
            aplicada=True, tipo__in=[TipoMedida.ALTURA, TipoMedida.DAP]
        ).values("arvore_id")
    ).count()
    inspecionadas_12m = validas.filter(ultima_inspecao_em__gte=agora - timedelta(days=365)).count()
    tarefas_abertas = tarefas.exclude(estado__in=ESTADOS_FINAIS_TAREFA)
    ocorrencias_abertas = ocorrencias.exclude(estado__in=ESTADOS_FINAIS)
    return {
        "arvores_registros": (arvores.count(), None),
        "arvores_validas": (total, None),
        "especie_confirmada": (com_especie, total),
        "com_medidas": (com_medidas, total),
        "cobertura_inspecao": (inspecionadas_12m, total),
        "inspecoes_em_revisao": (
            inspecoes.filter(estado=EstadoInspecao.EM_REVISAO).count(),
            None,
        ),
        "tarefas_inspecao_pendentes": (
            tarefas_abertas.filter(tipo=TipoTarefa.INSPECAO_ARVORE).count(),
            None,
        ),
        "tarefas_atrasadas": (tarefas_abertas.filter(prazo__lt=hoje).count(), None),
        "ocorrencias_abertas": (ocorrencias_abertas.count(), None),
        "ocorrencias_atrasadas": (ocorrencias_abertas.filter(prazo__lt=hoje).count(), None),
    }


def calcular_territorio(territorio: Territorio, *, hoje: date, agora: datetime) -> Instantaneos:
    """Mesmo recorte do painel para um bairro: geometria que intersecta o território.
    Árvores sem localização só entram no município (como no escopo municipal)."""
    geom = territorio.geom
    condicao = Q(geom__intersects=geom)
    if territorio.tipo == TipoTerritorio.MUNICIPIO:
        condicao |= Q(geom__isnull=True)
    return calcular(
        Arvore.objects.filter(condicao),
        Ocorrencia.objects.filter(geom__intersects=geom),
        Inspecao.objects.filter(arvore__geom__intersects=geom),
        Tarefa.objects.filter(geom__intersects=geom),
        hoje=hoje,
        agora=agora,
    )


def registrar(dia: date | None = None) -> int:
    """Registra os instantâneos de ``dia`` (padrão: hoje) para todos os territórios.
    Idempotente: repetir o dia atualiza os valores. Devolve o nº de registros."""
    dia = dia or timezone.localdate()
    agora = timezone.now()
    total = 0
    for territorio in Territorio.objects.all():
        for indicador, (num, den) in calcular_territorio(territorio, hoje=dia, agora=agora).items():
            RegistroIndicador.objects.update_or_create(
                data=dia,
                territorio=territorio,
                indicador=indicador,
                defaults={"numerador": num, "denominador": den},
            )
            total += 1
    return total


def territorios_do_escopo(usuario: Usuario) -> list[Territorio]:
    """Territórios cujos registros representam o escopo do usuário sem contar duas
    vezes: com município, só os municípios; senão, os do escopo menos os que estão
    dentro de outro território do próprio escopo (por ``pai``)."""
    do_usuario = list(Territorio.objects.filter(usuarios=usuario))
    municipios = [t for t in do_usuario if t.tipo == TipoTerritorio.MUNICIPIO]
    if municipios:
        return municipios
    ids = {t.pk for t in do_usuario}
    pais = dict(Territorio.objects.values_list("pk", "pai_id"))

    def dentro_de_outro(t: Territorio) -> bool:
        pai = pais.get(t.pk)
        while pai is not None:
            if pai in ids:
                return True
            pai = pais.get(pai)
        return False

    return [t for t in do_usuario if not dentro_de_outro(t)]


def territorio_no_escopo(usuario: Usuario, territorio: Territorio) -> bool:
    """O território é (ou está dentro de) um território do escopo do usuário."""
    ids = set(Territorio.objects.filter(usuarios=usuario).values_list("pk", flat=True))
    if Territorio.objects.filter(pk__in=ids, tipo=TipoTerritorio.MUNICIPIO).exists():
        return True
    pais = dict(Territorio.objects.values_list("pk", "pai_id"))
    atual: object = territorio.pk
    while atual is not None:
        if atual in ids:
            return True
        atual = pais.get(atual)
    return False


def _valor(num: int, den: int | None, percentual: bool) -> float | None:
    if not percentual:
        return num
    return round(100 * num / den, 1) if den else None


def historico(
    territorios: list[Territorio], inicio: date, fim: date, percentuais: set[str]
) -> dict[str, dict]:
    """Por indicador: ``serie`` (até 12 pontos, o último registro de cada mês nos
    365 dias até ``fim``) e ``anterior``/``anterior_em`` (registro mais próximo
    em ou antes de ``inicio``). Valores somam os territórios; um dia só conta se
    todos os territórios registraram o indicador nele."""
    if not territorios:
        return {}
    por_dia: dict[str, dict[date, list]] = defaultdict(lambda: defaultdict(lambda: [0, None, 0]))
    registros = RegistroIndicador.objects.filter(
        territorio__in=territorios, data__lte=fim, data__gte=fim - timedelta(days=3650)
    ).values_list("indicador", "data", "numerador", "denominador")
    for indicador, dia, num, den in registros:
        acc = por_dia[indicador][dia]
        acc[0] += num
        if den is not None:
            acc[1] = (acc[1] or 0) + den
        acc[2] += 1
    resultado = {}
    for indicador, dias in por_dia.items():
        completos = {d: a for d, a in dias.items() if a[2] == len(territorios)}
        pct = indicador in percentuais
        ultimo_do_mes: dict[tuple[int, int], date] = {}
        for d in sorted(completos):
            if d > fim - timedelta(days=JANELA_SERIE_DIAS):
                ultimo_do_mes[(d.year, d.month)] = d
        serie = [
            {"data": d, "valor": _valor(completos[d][0], completos[d][1], pct)}
            for d in sorted(ultimo_do_mes.values())[-MAX_PONTOS_SERIE:]
        ]
        serie = [p for p in serie if p["valor"] is not None]
        antes = [d for d in completos if d <= inicio]
        anterior = anterior_em = None
        if antes:
            anterior_em = max(antes)
            anterior = _valor(completos[anterior_em][0], completos[anterior_em][1], pct)
            if anterior is None:
                anterior_em = None
        resultado[indicador] = {"serie": serie, "anterior": anterior, "anterior_em": anterior_em}
    return resultado
