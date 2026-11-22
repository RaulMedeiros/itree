"""Autenticação por token de integração (``Authorization: Token <valor>``).

É própria e separada do OIDC: só as views de detecção a listam em ``authentication_classes``
(antes do OIDC, que ignora o esquema ``Token``). O token autentica como o usuário de serviço da
integração, e ``request.auth`` é o ``TokenIntegracao``, cujas permissões e escopo valem.
"""

from datetime import timedelta

from django.utils import timezone
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework import authentication, exceptions
from rest_framework.request import Request

from .models import TokenIntegracao

INTERVALO_ULTIMO_USO = timedelta(minutes=5)


class TokenIntegracaoAuthentication(authentication.BaseAuthentication):
    palavra_chave = "Token"

    def authenticate(self, request: Request):
        from . import servico

        cabecalho = authentication.get_authorization_header(request).split()
        if not cabecalho or cabecalho[0].lower() != self.palavra_chave.lower().encode():
            return None
        if len(cabecalho) != 2:
            raise exceptions.AuthenticationFailed("Cabeçalho Authorization malformado.")
        try:
            valor = cabecalho[1].decode()
        except UnicodeDecodeError:
            raise exceptions.AuthenticationFailed("Token inválido ou revogado.") from None
        token = servico.token_do_valor(valor)
        if token is None or not token.ativo:
            raise exceptions.AuthenticationFailed("Token inválido ou revogado.")
        agora = timezone.now()
        if token.ultimo_uso_em is None or agora - token.ultimo_uso_em > INTERVALO_ULTIMO_USO:
            TokenIntegracao.objects.filter(pk=token.pk).update(ultimo_uso_em=agora)
        return token.usuario, token

    def authenticate_header(self, request: Request) -> str:
        return self.palavra_chave


class TokenIntegracaoScheme(OpenApiAuthenticationExtension):
    target_class = "itree.deteccao.autenticacao.TokenIntegracaoAuthentication"
    name = "tokenIntegracao"

    def get_security_definition(self, auto_schema):
        return {
            "type": "apiKey",
            "in": "header",
            "name": "Authorization",
            "description": "Token de integração: `Authorization: Token <valor>`.",
        }
