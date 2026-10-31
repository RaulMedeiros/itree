"""Autenticação por token OIDC (Bearer JWT) emitido pelo Keycloak (RF-ACL-001).

Regras de vínculo do usuário local:
1. Pelo ``sub`` do token, se já vinculado.
2. Senão, pelo e-mail verificado, se um administrador pré-cadastrou o usuário.
3. Senão, cria o usuário **sem papéis**: ele entra, mas não vê dados até um
   administrador liberar o acesso.

Usuário desativado é recusado imediatamente (RF-ADM-001).
"""

import logging
from datetime import timedelta
from functools import lru_cache

import jwt
import pghistory
from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework import authentication, exceptions
from rest_framework.request import Request

from .models import Usuario

logger = logging.getLogger(__name__)

ALGORITMOS = ["RS256", "ES256"]


@lru_cache(maxsize=1)
def _cliente_jwks() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(settings.OIDC_JWKS_URL, cache_keys=True, lifespan=3600)


def obter_chave_assinatura(token: str):
    return _cliente_jwks().get_signing_key_from_jwt(token).key


def validar_token(token: str) -> dict:
    try:
        chave = obter_chave_assinatura(token)
        return jwt.decode(
            token,
            chave,
            algorithms=ALGORITMOS,
            audience=settings.OIDC_AUDIENCE,
            issuer=settings.OIDC_ISSUER,
            options={"require": ["exp", "iat", "sub", "iss", "aud"]},
            leeway=30,
        )
    except jwt.PyJWKClientError as exc:
        logger.warning("Falha ao obter chaves do provedor OIDC: %s", exc)
        raise exceptions.AuthenticationFailed("Não foi possível validar o token.") from exc
    except jwt.InvalidTokenError as exc:
        raise exceptions.AuthenticationFailed("Token inválido ou expirado.") from exc


def _vincular_usuario(claims: dict) -> Usuario:
    sub = claims["sub"]
    usuario = Usuario.objects.filter(oidc_sub=sub).first()
    if usuario:
        return usuario

    email = (claims.get("email") or "").strip().lower()
    if not email or not claims.get("email_verified", False):
        raise exceptions.AuthenticationFailed("O provedor não informou um e-mail verificado.")

    nome = claims.get("name") or claims.get("preferred_username") or ""
    with transaction.atomic(), pghistory.context(evento="vinculo_oidc", oidc_sub=sub):
        usuario = Usuario.objects.select_for_update().filter(email__iexact=email).first()
        if usuario:
            if usuario.oidc_sub and usuario.oidc_sub != sub:
                raise exceptions.AuthenticationFailed(
                    "Este e-mail já está vinculado a outra identidade."
                )
            usuario.oidc_sub = sub
            if not usuario.nome:
                usuario.nome = nome
            usuario.save(update_fields=["oidc_sub", "nome"])
            return usuario
        try:
            return Usuario.objects.create(
                username=sub, email=email, nome=nome, oidc_sub=sub, papeis=[]
            )
        except IntegrityError:
            # Corrida entre duas primeiras requisições do mesmo usuário.
            return Usuario.objects.get(oidc_sub=sub)


INTERVALO_ULTIMO_ACESSO = timedelta(minutes=15)


def _registrar_acesso(usuario: Usuario) -> None:
    """Atualiza ``last_login`` no máximo a cada 15 min. O campo é excluído da
    auditoria, então não gera eventos a cada requisição."""
    agora = timezone.now()
    if usuario.last_login is None or agora - usuario.last_login > INTERVALO_ULTIMO_ACESSO:
        Usuario.objects.filter(pk=usuario.pk).update(last_login=agora)
        usuario.last_login = agora


class OIDCAuthentication(authentication.BaseAuthentication):
    palavra_chave = "Bearer"

    def authenticate(self, request: Request):
        cabecalho = authentication.get_authorization_header(request).split()
        if not cabecalho or cabecalho[0].lower() != self.palavra_chave.lower().encode():
            return None
        if len(cabecalho) != 2:
            raise exceptions.AuthenticationFailed("Cabeçalho Authorization malformado.")

        claims = validar_token(cabecalho[1].decode())
        usuario = _vincular_usuario(claims)
        if not usuario.is_active:
            raise exceptions.AuthenticationFailed("Usuário desativado.")
        _registrar_acesso(usuario)
        return usuario, claims

    def authenticate_header(self, request: Request) -> str:
        return self.palavra_chave


class OIDCAuthenticationScheme(OpenApiAuthenticationExtension):
    target_class = "itree.contas.autenticacao.OIDCAuthentication"
    name = "oidc"

    def get_security_definition(self, auto_schema):
        return {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
