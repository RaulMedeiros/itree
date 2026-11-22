"""Importa um pacote de detecções (ZIP) pela linha de comando.

    manage.py importar_deteccoes pacote.zip --usuario pessoa@exemplo.org

O pacote tem ``lote.json``, ``deteccoes.geojson`` (ou ``deteccoes.gpkg``) e as fotos; o formato
está em docs/integracoes/deteccao-automatica.md. O envio vale pelo escopo territorial da pessoa
indicada e passa pelo mesmo caminho da tela e da API (contrato, junção, auditoria).
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from itree.contas.models import Usuario
from itree.deteccao import servico
from itree.deteccao.contrato import ErroContrato
from itree.deteccao.models import CanalLote


class Command(BaseCommand):
    help = "Importa um pacote ZIP de detecções automáticas de árvores."

    def add_arguments(self, parser):
        parser.add_argument("pacote", help="Arquivo .zip do pacote.")
        parser.add_argument(
            "--usuario",
            required=True,
            help="E-mail de quem envia (precisa de deteccao.enviar e de escopo territorial).",
        )

    def handle(self, *args, **opts):
        caminho = Path(opts["pacote"])
        if not caminho.is_file():
            raise CommandError(f"Arquivo não encontrado: {caminho}")
        usuario = Usuario.objects.filter(email__iexact=opts["usuario"], is_active=True).first()
        if usuario is None:
            raise CommandError(f"Usuário não encontrado ou inativo: {opts['usuario']}")
        if not usuario.tem_permissao("deteccao.enviar"):
            raise CommandError("Este usuário não tem a permissão deteccao.enviar.")
        envio = servico.Envio(canal=CanalLote.PACOTE, usuario=usuario, arquivo_nome=caminho.name)
        try:
            lote = servico.enviar_pacote(caminho.read_bytes(), envio)
        except ErroContrato as exc:
            raise CommandError("; ".join(exc.mensagens)) from exc
        except servico.LoteJaRecebido as exc:
            raise CommandError(str(exc)) from exc
        except servico.ArmazenamentoNaoConfigurado as exc:
            raise CommandError(
                "O pacote tem fotos e o armazenamento de arquivos não está configurado."
            ) from exc
        self.stdout.write(
            self.style.SUCCESS(
                f"Lote {lote.id_externo} ({lote.get_situacao_display().lower()}): "
                f"{lote.total} detecção(ões), {lote.arvores_criadas} árvore(s) criada(s), "
                f"{lote.arvores_juntadas} juntada(s), {lote.recusadas} recusada(s), "
                f"{lote.pontos_criados} ponto(s) de plantio, "
                f"{lote.possiveis_remocoes} possível(is) remoção(ões)."
            )
        )
        for erro in lote.erros[:20]:
            self.stderr.write(f"  recusada {erro['id']}: {erro['motivo']}")
