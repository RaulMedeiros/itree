"""Importa o plantio de mudas da URBFOR (planilha de 2022, em formato de ficha).

    manage.py importar_plantio_urbfor                    # baixa a planilha do CKAN
    manage.py importar_plantio_urbfor --arquivo plantio.xlsx

Lê as fichas (data, endereço em texto, local, espécies e quantidades) e grava
``RegistroPlantio``. O bairro vem só do texto do endereço, com os aliases do manejo da URBFOR;
sem bairro no texto, fica vazio e o motivo é gravado. **Não geocodifica e não cria árvore**
(DP-18). Exige os bairros cadastrados (``importar_limites_fortaleza``). Idempotente por ano.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.indicadores import doacao_plantio as d
from itree.indicadores.models import MotivoSemBairro
from itree.inventario.leitura_arquivos import ErroArquivo


class Command(BaseCommand):
    help = "Importa o plantio de mudas da URBFOR (2022), com o bairro lido do endereço."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo", help="XLSX local do plantio.")

    def handle(self, *args, arquivo=None, **opts):
        try:
            conteudo = (
                Path(arquivo).read_bytes()
                if arquivo
                else d.baixar_planilhas(["plantio"])["plantio"]
            )
            r = d.importar_plantio(conteudo)
        except OSError as exc:
            raise CommandError(f"Não foi possível ler o arquivo: {exc}") from exc
        except (d.PlanilhaInvalida, ErroArquivo) as exc:
            raise CommandError(str(exc)) from exc

        escrever = self.stdout.write
        pct = (lambda n: f"{100 * n / r.fichas:.1f}%".replace(".", ",")) if r.fichas else str
        escrever(
            self.style.SUCCESS(
                f"{r.fichas} plantio(s) lido(s), {r.mudas} muda(s) "
                f"(total informado nas fichas: {r.total_declarado})."
            )
        )
        escrever(
            f"  Com bairro identificado: {r.com_bairro} ({pct(r.com_bairro)}), "
            f"{r.mudas_com_bairro} muda(s)."
        )
        escrever(f"  Sem bairro: {r.fichas - r.com_bairro}.")
        for motivo, n in r.motivos.most_common():
            escrever(f"    {MotivoSemBairro(motivo).label}: {n}")
        if r.fichas_sem_especie:
            escrever(f"  {r.fichas_sem_especie} ficha(s) sem espécie, ignoradas.")
        if r.textos_nao_reconhecidos:
            escrever("Textos de bairro não reconhecidos:")
            for texto, n in r.textos_nao_reconhecidos.most_common(10):
                escrever(f"  {texto}: {n} muda(s)")
        for linha, motivo, texto in r.nao_entendidas[:20]:
            escrever(self.style.WARNING(f"  Linha {linha}: {motivo} {texto!r}"))
