"""Importa a adoção de praças e áreas verdes (Fortaleza em Mapas, mapa 622, SEUMA).

    manage.py importar_adocao_pracas                      # pela API
    manage.py importar_adocao_pracas --arquivo adocao.geojson

Grava só o que não é pessoal: identificador, nome da praça, regional, ponto, ano de referência e
a categoria do adotante (empresa, associação ou condomínio, quando a razão social deixa claro).
**O nome do adotante é descartado na leitura**, sem ser gravado nem mostrado. Liga cada ponto à
praça mais próxima a até 50 m; o que não tem praça nesse raio fica sem vínculo. Reimportar
atualiza pelo identificador e remove o que saiu da fonte. Rode depois de ``importar_areas_verdes``.
Regras em ``itree.areas_verdes.adocao``.
"""

from django.core.management.base import BaseCommand, CommandError

from itree.areas_verdes import adocao
from itree.areas_verdes.management.commands.importar_areas_verdes import (
    API,
    LICENCA,
    _srid_declarado,
    ler_feicoes,
    url_do_mapa,
)
from itree.areas_verdes.models import TipoAdotante


class Command(BaseCommand):
    help = "Importa a adoção de praças (mapa 622), sem o nome do adotante."

    def add_arguments(self, parser):
        parser.add_argument("--arquivo", default=None, help="GeoJSON local no lugar da API.")
        parser.add_argument("--api", default=API, help="Endereço base da API (padrão: oficial).")

    def handle(self, *args, arquivo=None, api=API, **opts):
        dados = ler_feicoes(arquivo, adocao.MAPA, api)
        try:
            r = adocao.importar(
                dados,
                fonte_url=url_do_mapa(adocao.MAPA, api),
                licenca=LICENCA,
                srid=_srid_declarado(dados),
            )
        except adocao.AdocaoInvalida as exc:
            raise CommandError(str(exc)) from exc
        escrever = self.stdout.write
        escrever(
            self.style.SUCCESS(
                f"Adoção de praças: {r.lidas} na fonte, {r.criadas} criada(s), "
                f"{r.atualizadas} atualizada(s), {r.removidas} removida(s), "
                f"{r.ignoradas} ignorada(s) (sem ponto, id ou nome)."
            )
        )
        escrever(
            f"  Ligadas a uma praça a até {adocao.RAIO_VINCULO_M} m: {r.ligadas} "
            f"({r.pracas_adotadas} praça(s) adotada(s)); sem vínculo: {r.sem_vinculo}."
        )
        escrever(
            "  Categoria do adotante (sem nome): "
            + ", ".join(f"{TipoAdotante(t).label} {n}" for t, n in sorted(r.tipos.items()))
        )
        if r.sem_vinculo:
            escrever(
                "  Pontos sem vínculo ficam registrados, mas não aparecem na ficha de nenhuma "
                "praça. Se faltam praças, rode importar_areas_verdes antes."
            )
