"""Cria (ou promove) o primeiro administrador.

Sem um administrador ninguém consegue atribuir papéis pela interface, então
este comando é o ponto de partida de cada ambiente:

    manage.py criar_administrador --email ana@prefeitura.gov.br --nome "Ana" \\
        --territorio Fortaleza

O usuário entra depois pelo provedor de login com o mesmo e-mail (verificado).
"""

import pghistory
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from itree.contas.models import EscopoUsuario, Usuario
from itree.contas.permissoes import Papel
from itree.territorio.models import Territorio


class Command(BaseCommand):
    help = "Cria ou promove um usuário a administrador."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--nome", default="")
        parser.add_argument(
            "--territorio",
            action="append",
            default=[],
            help="Nome de território para o escopo (repetível).",
        )

    @transaction.atomic
    def handle(self, *args, email, nome, territorio, **opts):
        email = email.strip().lower()
        with pghistory.context(evento="criar_administrador", origem="cli"):
            usuario, criado = Usuario.objects.get_or_create(
                email=email, defaults={"username": email, "nome": nome}
            )
            if criado:
                usuario.set_unusable_password()
            if Papel.ADMINISTRADOR not in usuario.papeis:
                usuario.papeis = sorted({*usuario.papeis, Papel.ADMINISTRADOR})
            usuario.is_active = True
            usuario.save()

            for nome_territorio in territorio:
                encontrados = Territorio.objects.filter(nome__iexact=nome_territorio)
                if encontrados.count() != 1:
                    raise CommandError(
                        f"Território '{nome_territorio}': {encontrados.count()} encontrados; "
                        "importe os territórios antes ou use o nome exato."
                    )
                EscopoUsuario.objects.get_or_create(usuario=usuario, territorio=encontrados[0])

        acao = "criado" if criado else "atualizado"
        self.stdout.write(self.style.SUCCESS(f"Administrador {email} {acao}."))
