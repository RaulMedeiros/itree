"""Backfill mensal dos focos de calor do INPE (BDQueimadas).

Baixa os CSV mensais do Brasil inteiro (23 a 137 MB descompactados; .zip até 2023
e .csv a partir de 2024), lê em fluxo e guarda só o estado escolhido (padrão
Ceará) antes de montar os registros, para não carregar o arquivo na memória.
Depois passa pelo mesmo ``ingerir`` do dia a dia: idempotente pelo id do foco,
só com focos do município (ou junto de parque ou unidade de conservação) e com a
mesma proveniência. Não envia notificações: é carga histórica.

    manage.py ingerir_focos_historico --desde 2023-01 --ate 2023-03

Os focos entram como "Alerta detectado", como os do dia a dia, e aparecem nas
pendências de triagem; use períodos que a equipe queira analisar.
"""

import re

from django.core.management.base import BaseCommand, CommandError

from itree.alertas import fontes


def _mes(texto: str) -> tuple[int, int]:
    achado = re.fullmatch(r"(\d{4})-(\d{2})", texto)
    if not achado or not 1 <= int(achado[2]) <= 12:
        raise CommandError(f"Mês inválido: {texto!r}. Use AAAA-MM.")
    return int(achado[1]), int(achado[2])


def meses_entre(desde: tuple[int, int], ate: tuple[int, int]) -> list[tuple[int, int]]:
    meses, (ano, mes) = [], desde
    while (ano, mes) <= ate:
        meses.append((ano, mes))
        ano, mes = (ano + 1, 1) if mes == 12 else (ano, mes + 1)
    return meses


class Command(BaseCommand):
    help = "Ingere os focos de calor mensais do INPE (BDQueimadas), filtrando pelo estado."

    def add_arguments(self, parser):
        parser.add_argument("--desde", required=True, help="Primeiro mês, AAAA-MM.")
        parser.add_argument("--ate", required=True, help="Último mês, AAAA-MM (inclusive).")
        parser.add_argument(
            "--estado",
            default=fontes.ESTADO_PADRAO_FOCOS,
            help="Estado a manter, como na coluna 'estado' (sem distinguir acento nem caixa).",
        )
        parser.add_argument(
            "--base", default=fontes.URL_FOCOS_MENSAL, help="Endereço dos arquivos mensais."
        )

    def handle(self, *args, desde, ate, estado, base, **opts):
        inicio, fim = _mes(desde), _mes(ate)
        if inicio > fim:
            raise CommandError("--desde não pode ser posterior a --ate.")
        falhas = []
        for ano, mes in meses_entre(inicio, fim):
            ingestao, lidas = fontes.ingerir_focos_mensal(ano, mes, estado, base)
            rotulo = f"{ano:04d}-{mes:02d}"
            if not ingestao.sucesso:
                falhas.append(f"{rotulo}: {ingestao.erro}")
                self.stderr.write(self.style.ERROR(f"{rotulo}: falhou: {ingestao.erro}"))
                continue
            self.stdout.write(
                self.style.SUCCESS(
                    f"{rotulo}: {lidas} focos no Brasil, {ingestao.recebidos} em {estado}: "
                    f"{ingestao.novos} novos, {ingestao.ja_existentes} já existentes, "
                    f"{ingestao.fora_do_municipio} fora do município, "
                    f"{ingestao.invalidos} inválidos."
                )
            )
        if falhas:
            raise CommandError(f"{len(falhas)} mês(es) com falha: " + "; ".join(falhas))
