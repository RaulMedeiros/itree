"""Importa a doação de mudas da URBFOR (planilhas de 2022, pessoa física e jurídica).

    manage.py importar_doacao_mudas                      # baixa as duas planilhas do CKAN
    manage.py importar_doacao_mudas --arquivo-pf pf.xlsx --arquivo-pj pj.xlsx

Lê as fichas de atendimento (``itree.indicadores.fichas_urbfor``) e grava ``DoacaoMudas``: ano,
tipo de beneficiário, categoria, espécie (e a do catálogo, quando casa), quantidade e a
proveniência. **Não grava requerente nem endereço** e não vai ao mapa: a planilha não tem local.
Idempotente por tipo e ano. Não precisa de limites territoriais.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.indicadores import doacao_plantio as d
from itree.inventario.leitura_arquivos import ErroArquivo

NOMES = {"pf": "pessoa física", "pj": "pessoa jurídica"}


class Command(BaseCommand):
    help = "Importa a doação de mudas da URBFOR (2022), por espécie, sem dado pessoal."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo-pf", help="XLSX local da doação a pessoa física.")
        parser.add_argument("--arquivo-pj", help="XLSX local da doação a pessoa jurídica.")

    def handle(self, *args, arquivo_pf=None, arquivo_pj=None, **opts):
        locais = {"pf": arquivo_pf, "pj": arquivo_pj}
        try:
            if any(locais.values()):
                planilhas = {k: Path(v).read_bytes() for k, v in locais.items() if v}
            else:
                planilhas = d.baixar_planilhas(["pf", "pj"])
            resultados = d.importar_doacao(planilhas)
        except OSError as exc:
            raise CommandError(f"Não foi possível ler o arquivo: {exc}") from exc
        except (d.PlanilhaInvalida, ErroArquivo) as exc:
            raise CommandError(str(exc)) from exc

        escrever = self.stdout.write
        for tipo, r in resultados.items():
            escrever(
                self.style.SUCCESS(
                    f"Doação a {NOMES[tipo]}: {r.fichas} ficha(s), {r.linhas} linha(s) de espécie, "
                    f"{r.mudas} muda(s)."
                )
            )
            escrever(
                f"  Total informado nas fichas: {r.total_declarado}"
                + (
                    f"; {r.fichas_com_total_diferente} ficha(s) com soma diferente do total."
                    if r.fichas_com_total_diferente
                    else " (confere com a soma)."
                )
            )
            escrever(f"  {r.mudas_sem_categoria} muda(s) sem categoria na planilha.")
            escrever(f"  {r.linhas_no_catalogo} linha(s) casadas com o catálogo de espécies.")
            if r.fichas_sem_especie:
                escrever(f"  {r.fichas_sem_especie} ficha(s) sem espécie, ignoradas.")
            for linha, motivo, texto in r.nao_entendidas[:20]:
                escrever(self.style.WARNING(f"  Linha {linha}: {motivo} {texto!r}"))
