"""Confere as unidades de conservação com o CNUC (MMA, CC BY) e grava o código e a esfera.

    manage.py conferir_ucs_cnuc                      # baixa a tabela do CNUC
    manage.py conferir_ucs_cnuc --arquivo cnuc.csv   # CSV local (ISO-8859-1, ";")
    manage.py conferir_ucs_cnuc --simular            # só o relatório, sem gravar

Casa pelo nome normalizado (regra em ``itree.areas_verdes.cnuc``) e grava
``codigo_cnuc``, ``esfera_cnuc`` e ``cnuc_conferido_em`` nas áreas que casarem. Feições
da mesma unidade (a APA do Estuário do Rio Ceará tem 4) recebem o mesmo código. O
relatório lista as unidades do mapa que não casaram, as ambíguas, as divergências de
esfera e as unidades do CNUC no município que o mapa não traz. Reexecutar refaz o
cruzamento: quem deixou de casar perde o código.

Fonte: Ministério do Meio Ambiente (MMA), Cadastro Nacional de Unidades de Conservação,
licença Creative Commons Atribuição (CC BY).
"""

from pathlib import Path

import pghistory
import requests
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from itree.areas_verdes.cnuc import CnucInvalido, conferir, ler_cnuc
from itree.areas_verdes.models import AreaVerde, TipoAreaVerde

URL_CNUC = (
    "https://dados.mma.gov.br/dataset/44b6dc8a-dc82-4a84-8d95-1b0da7c85dac/resource/"
    "72dd3d2d-3cca-4b97-b382-a1c90531e379/download/cnuc_2026_07.csv"
)
TIMEOUT_S = 120


class Command(BaseCommand):
    help = "Confere as unidades de conservação com o CNUC e grava código e esfera."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo", help="CSV do CNUC local, no lugar do download.")
        parser.add_argument("--url", default=URL_CNUC, help="Endereço do CSV (padrão: 2026-07).")
        parser.add_argument("--uf", default="CE", help="UF das unidades do CNUC (padrão: CE).")
        parser.add_argument("--municipio", default="Fortaleza")
        parser.add_argument("--simular", action="store_true", help="Só mostra o relatório.")

    def _conteudo(self, arquivo, url) -> bytes:
        try:
            if arquivo:
                return Path(arquivo).read_bytes()
            resposta = requests.get(url, timeout=TIMEOUT_S, headers={"User-Agent": "iTree"})
            resposta.raise_for_status()
            return resposta.content
        except (OSError, requests.RequestException) as exc:
            raise CommandError(f"Não foi possível obter o CNUC: {exc}") from exc

    @transaction.atomic
    def handle(self, *args, **opts):
        try:
            ucs = ler_cnuc(self._conteudo(opts["arquivo"], opts["url"]), opts["uf"])
        except CnucInvalido as exc:
            raise CommandError(str(exc)) from exc
        areas = list(AreaVerde.objects.filter(tipo=TipoAreaVerde.UNIDADE_CONSERVACAO))
        resultado = conferir(areas, ucs, opts["municipio"])
        casadas = {nome: uc for nome, (uc, _) in resultado.casadas.items()}

        if not opts["simular"]:
            agora = timezone.now()
            with pghistory.context(evento="conferencia_cnuc"):
                for area in areas:
                    uc = casadas.get(area.nome)
                    novo = (uc.codigo, uc.esfera, agora) if uc else ("", "", None)
                    atual = (area.codigo_cnuc, area.esfera_cnuc, area.cnuc_conferido_em)
                    if (atual[0], atual[1]) == novo[:2] and (atual[2] is None) == (uc is None):
                        continue
                    area.codigo_cnuc, area.esfera_cnuc, area.cnuc_conferido_em = novo
                    area.save(
                        update_fields=[
                            "codigo_cnuc",
                            "esfera_cnuc",
                            "cnuc_conferido_em",
                            "atualizado_em",
                        ]
                    )

        escrever = self.stdout.write
        feicoes = sum(n for _, n in resultado.casadas.values())
        unidades = {uc.codigo for uc in casadas.values()}
        escrever(
            self.style.SUCCESS(
                f"{len(unidades)} unidade(s) casada(s) com o CNUC "
                f"({feicoes} de {len(areas)} feições), {len(ucs)} unidades do CNUC em {opts['uf']}."
                + (" Simulação: nada foi gravado." if opts["simular"] else "")
            )
        )
        for nome, (uc, n) in sorted(resultado.casadas.items()):
            escrever(f"  {nome} -> {uc.codigo} ({uc.esfera}), {n} feição(ões)")
        if resultado.nao_casadas:
            escrever(
                self.style.WARNING(
                    f"{len(resultado.nao_casadas)} unidade(s) do mapa sem correspondente no CNUC:"
                )
            )
            for nome, n in sorted(resultado.nao_casadas.items()):
                escrever(f"  {nome} ({n} feição(ões))")
        for nome, codigos in sorted(resultado.ambiguas.items()):
            escrever(self.style.WARNING(f"Ambígua (mais de um código): {nome}: {codigos}"))
        for texto in resultado.divergencias_de_esfera:
            escrever(self.style.WARNING(f"Esfera diferente: {texto}"))
        if resultado.so_no_cnuc:
            escrever(f"No CNUC em {opts['municipio']} e fora do mapa de unidades:")
            for uc in resultado.so_no_cnuc:
                escrever(f"  {uc.nome} ({uc.codigo}, {uc.esfera})")
