"""Linhas das análises de doação de mudas e de plantio da URBFOR (2022).

Só leem o que ``importar_doacao_mudas`` e ``importar_plantio_urbfor`` gravaram. Doação não tem
local: é um total do município, por isso só vale para quem tem escopo municipal (a regra está
na view). O plantio vai ao bairro que o texto do endereço permitiu; o resto fica à parte.
"""

from collections import Counter, defaultdict

from django.db.models import Sum

from itree.contas.acesso import tem_escopo_municipal
from itree.core.textos import sem_codigos_internos
from itree.indicadores import externos
from itree.indicadores.doacao_plantio import (
    FONTE,
    FONTE_URL,
    LICENCA,
    ROTULOS_CATEGORIA,
)
from itree.indicadores.fichas_urbfor import simples
from itree.indicadores.models import DoacaoMudas, MotivoSemBairro, RegistroPlantio

LIMITE_ESPECIES = 15
FONTE_TEXTO = (
    f"{FONTE}, dados abertos de Fortaleza ({FONTE_URL}); planilhas de 2022. "
    f"Licença: {sem_codigos_internos(LICENCA)}."
)

DEFINICAO_DOACAO = (
    "Mudas doadas pela URBFOR em 2022 a pessoas físicas e jurídicas, somadas por espécie. "
    "As espécies são as escritas pelo atendimento (grafias iguais, sem diferença de acento, "
    "caixa ou espaço, são somadas; o nome científico não vem na planilha), e as "
    f"{LIMITE_ESPECIES} mais doadas "
    'aparecem uma a uma e o restante em "Outras". Ressalvas: (1) a planilha não tem local de '
    "plantio, então o dado não vai ao mapa, e não diz onde as mudas foram plantadas nem se "
    "vingaram; (2) a maioria das mudas é de ornamentais pequenas (por exemplo, kits e "
    "pingo-de-ouro), e não de árvores de rua; (3) não há nome nem endereço de quem recebeu, "
    "porque a planilha da pessoa física os traz e eles não foram importados; (4) o número é o "
    "informado pela URBFOR, sem conferência em campo, e não depende do período escolhido."
)
DEFINICAO_CATEGORIA = (
    "Mudas doadas pela URBFOR em 2022, somadas pela categoria da planilha (ornamental, nativa "
    "ou frutífera, palmeira, medicinal). Quando a linha não traz a categoria, vale a lista "
    'auxiliar da própria planilha; o que não consta em nenhuma fica em "Categoria não '
    'informada". Mesmas ressalvas de "Mudas doadas por espécie". Não depende do período escolhido.'
)
DEFINICAO_PLANTIO = (
    "Mudas plantadas pela URBFOR em 2022, somadas por bairro. Ressalvas: (1) a planilha é um "
    "relatório em fichas, sem coordenadas, e o bairro foi lido do texto do endereço; a maioria "
    "das fichas traz só o nome do local (parque, avenida, escola) ou um endereço sem bairro, e "
    'fica em "Sem bairro identificado", visível só com escopo municipal; (2) bairro fora da '
    "lista não teve plantio identificado, o que não é o mesmo que zero; (3) as mudas são, em "
    "grande parte, ornamentais pequenas, e não árvores do inventário: nada foi geocodificado "
    "nem criou árvore; (4) os números são os informados pela URBFOR, sem conferência em campo, "
    "e não dependem do período escolhido."
)


def _milhar(n: int) -> str:
    return f"{n:,}".replace(",", ".")


def linhas_doacao_por_especie() -> list[dict]:
    """Top ``LIMITE_ESPECIES`` espécies por mudas doadas e o restante em "Outras"."""
    grupos: dict[str, dict] = {}
    for d in DoacaoMudas.objects.select_related("especie"):
        chave = (
            f"c:{d.especie.nome_cientifico}"
            if d.especie
            else f"t:{simples(d.especie_texto).replace(' ', '') or d.especie_texto}"
        )
        g = grupos.setdefault(
            chave,
            {
                "n": 0,
                "grafias": Counter(),
                "categorias": Counter(),
                "tipos": Counter(),
                "esp": d.especie,
            },
        )
        g["n"] += d.quantidade
        g["grafias"][d.especie_texto.strip()] += d.quantidade
        g["categorias"][d.categoria] += d.quantidade
        g["tipos"][d.beneficiario] += d.quantidade
    ordenados = sorted(grupos.values(), key=lambda g: (-g["n"], g["grafias"].most_common(1)[0][0]))
    linhas = []
    for g in ordenados[:LIMITE_ESPECIES]:
        grafia = g["grafias"].most_common(1)[0][0]
        rotulo = grafia[:1].upper() + grafia[1:]
        if g["esp"]:
            rotulo = f"{rotulo} ({g['esp'].nome_cientifico})"
        categoria = next((c for c, _ in g["categorias"].most_common() if c), "")
        partes = [ROTULOS_CATEGORIA[categoria]] if categoria else []
        partes.append(
            " · ".join(
                f"{rot} {_milhar(g['tipos'][k])}"
                for k, rot in (("pf", "pessoa física"), ("pj", "pessoa jurídica"))
                if g["tipos"].get(k)
            )
        )
        linhas.append(
            {"rotulo": rotulo, "valor": g["n"], "detalhe": " · ".join(p for p in partes if p)}
        )
    restante = ordenados[LIMITE_ESPECIES:]
    if restante:
        linhas.append(
            {
                "rotulo": f"Outras ({len(restante)} espécies)",
                "valor": sum(g["n"] for g in restante),
                "detalhe": "",
            }
        )
    return linhas


def linhas_doacao_por_categoria() -> list[dict]:
    somas = dict(
        DoacaoMudas.objects.values_list("categoria").annotate(n=Sum("quantidade")).order_by()
    )
    linhas = [
        {"rotulo": rotulo, "valor": somas.get(chave, 0), "detalhe": ""}
        for chave, rotulo in ROTULOS_CATEGORIA.items()
        if somas.get(chave)
    ]
    return sorted(linhas, key=lambda linha: -linha["valor"])


def linhas_plantio_por_bairro(usuario) -> list[dict]:
    """Mudas plantadas por bairro do escopo e, para o escopo municipal, o que ficou sem bairro."""
    bairros = {b.pk: b for b in externos.bairros_do_escopo(usuario)}
    por_bairro: dict = defaultdict(lambda: [0, 0])
    sem_bairro = [0, 0]
    motivos: Counter = Counter()
    for r in RegistroPlantio.objects.only("bairro_id", "total_mudas", "motivo_sem_bairro"):
        if r.bairro_id is None:
            sem_bairro[0] += r.total_mudas
            sem_bairro[1] += 1
            motivos[r.motivo_sem_bairro] += r.total_mudas
        elif r.bairro_id in bairros:
            por_bairro[r.bairro_id][0] += r.total_mudas
            por_bairro[r.bairro_id][1] += 1
    linhas = [
        {
            "rotulo": bairros[pk].nome,
            "valor": mudas,
            "detalhe": f"{fichas} plantio(s)",
            "territorio_id": str(pk),
        }
        for pk, (mudas, fichas) in por_bairro.items()
    ]
    linhas.sort(key=lambda linha: (-linha["valor"], linha["rotulo"]))
    if sem_bairro[0] and tem_escopo_municipal(usuario):
        por_motivo = " · ".join(
            f"{MotivoSemBairro(m).label} {_milhar(n)}" for m, n in motivos.most_common()
        )
        linhas.append(
            {
                "rotulo": "Sem bairro identificado",
                "valor": sem_bairro[0],
                "detalhe": f"{sem_bairro[1]} plantio(s) · {por_motivo}",
                "territorio_id": None,
            }
        )
    return linhas
