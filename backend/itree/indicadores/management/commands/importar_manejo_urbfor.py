"""Importa o manejo de árvores da URBFOR (podas, recolhimento e supressão de 2023).

    manage.py importar_manejo_urbfor                    # baixa os CSVs mensais do CKAN
    manage.py importar_manejo_urbfor --arquivo jan2023.csv --arquivo fev2023.csv

Lê as planilhas mensais (ISO-8859-1, ``;``), agrega por bairro e mês, sem geocodificar, e
grava ``IndicadorTerritorialExterno`` (fonte URBFOR, 2023, licença não declarada). Não cria
árvore, ocorrência nem tarefa. Exige o município e os bairros cadastrados
(``importar_limites_fortaleza``). Idempotente por mês. Regras de leitura e ressalvas em
``itree.indicadores.manejo_urbfor``.
"""

from collections import Counter
from pathlib import Path

import requests
from django.core.management.base import BaseCommand, CommandError

from itree.indicadores import manejo_urbfor as m

TIMEOUT_S = 120


def baixar(api: str = m.API_CKAN, dataset: str = m.DATASET) -> list[tuple[str, bytes]]:
    """Os CSVs do dataset, pela API do CKAN: lista de (nome, conteúdo)."""
    try:
        resposta = requests.get(api, params={"id": dataset}, timeout=TIMEOUT_S)
        resposta.raise_for_status()
        recursos = resposta.json()["result"]["resources"]
        baixados = []
        for recurso in recursos:
            if str(recurso.get("format", "")).lower() != "csv":
                continue
            arquivo = requests.get(recurso["url"], timeout=TIMEOUT_S)
            arquivo.raise_for_status()
            baixados.append((recurso.get("name") or recurso["url"], arquivo.content))
    except (requests.RequestException, KeyError, ValueError) as exc:
        raise CommandError(f"Não foi possível obter os CSVs da URBFOR: {exc}") from exc
    if not baixados:
        raise CommandError("O dataset não tem recursos CSV.")
    return baixados


class Command(BaseCommand):
    help = "Importa o manejo registrado pela URBFOR (2023), agregado por bairro e mês."

    def add_arguments(self, parser):
        parser.add_argument(
            "--arquivo", action="append", help="CSV mensal local; repita para mais de um."
        )
        parser.add_argument(
            "--ano", type=int, default=m.ANO, help="Ano dos arquivos (padrão 2023)."
        )

    def handle(self, *args, arquivo=None, ano=m.ANO, **opts):
        if arquivo:
            try:
                origens = [(a, Path(a).read_bytes()) for a in arquivo]
            except OSError as exc:
                raise CommandError(f"Não foi possível ler o arquivo: {exc}") from exc
        else:
            origens = baixar()
        conteudos = []
        for nome, conteudo in origens:
            try:
                leitura = m.ler_mes(conteudo)
            except m.ManejoInvalido as exc:
                raise CommandError(f"{nome}: {exc}") from exc
            if leitura.ano != ano:
                self.stdout.write(f"{nome}: ano {leitura.ano}, fora de {ano}; ignorado.")
                continue
            conteudos.append(conteudo)
        if not conteudos:
            raise CommandError(f"Nenhuma planilha de {ano} para importar.")
        try:
            r = m.importar(conteudos)
        except m.ManejoInvalido as exc:
            raise CommandError(str(exc)) from exc

        escrever = self.stdout.write
        for mes in sorted(r.meses, key=lambda x: (x.ano, x.mes)):
            lido = sum(mes.totais.values())
            escrever(
                f"{mes.mes:02d}/{mes.ano}: {mes.servicos} serviço(s), "
                f"{lido} árvore(s) (poda {mes.totais['poda']}, "
                f"supressão {mes.totais['supressao']}, "
                f"recolhimento {mes.totais['recolhimento']})."
            )
            if mes.total_declarado is not None and mes.total_declarado != mes.totais:
                escrever(
                    self.style.WARNING(
                        f"  A soma difere da linha TOTAL da planilha: {mes.total_declarado}."
                    )
                )
            if mes.datas_fora_do_mes:
                escrever(
                    f"  {mes.datas_fora_do_mes} linha(s) com data de outro mês; "
                    "vale o mês do arquivo."
                )
        total = r.soma("totais")
        ident, ambiguo, sem = (r.soma(c) for c in ("identificado", "ambiguo", "nao_identificado"))
        pct = (lambda n: f"{100 * n / total:.1f}%".replace(".", ",")) if total else (lambda n: "0%")
        escrever(
            self.style.SUCCESS(
                f"{r.gravados} indicador(es) gravado(s) em {len(r.meses)} mês(es): "
                f"{total} árvore(s)."
            )
        )
        escrever(f"  Com bairro identificado: {ident} ({pct(ident)}).")
        escrever(f"  Bairro ambíguo (dois bairros com o mesmo nome): {ambiguo} ({pct(ambiguo)}).")
        escrever(f"  Sem bairro identificado: {sem} ({pct(sem)}), somados no município.")
        divergente = sum(x.regional_divergente for x in r.meses)
        if divergente:
            escrever(
                f"  {divergente} árvore(s) de serviços cuja regional difere da do bairro "
                "cadastrado (mantido o bairro)."
            )
        desconhecidos = Counter()
        for x in r.meses:
            desconhecidos.update(x.textos_nao_reconhecidos)
        if desconhecidos:
            escrever("Textos de bairro não reconhecidos que mais pesam:")
            for texto, n in desconhecidos.most_common(10):
                escrever(f"  {texto}: {n}")
