import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from django.contrib.gis.geos import MultiPolygon, Polygon
from django.utils import timezone
from rest_framework.test import APIClient

from itree.contas import autenticacao
from itree.contas.models import Usuario
from itree.territorio.models import Territorio

CHAVE = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OUTRA_CHAVE = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def _jwks_falso(monkeypatch, settings):
    settings.OIDC_ISSUER = "https://idp.teste/realms/itree"
    settings.OIDC_AUDIENCE = "itree-api"
    monkeypatch.setattr(autenticacao, "obter_chave_assinatura", lambda token: CHAVE.public_key())


def emitir_token(sub=None, chave=CHAVE, **extras) -> str:
    agora = int(time.time())
    claims = {
        "iss": "https://idp.teste/realms/itree",
        "aud": "itree-api",
        "sub": sub or str(uuid.uuid4()),
        "iat": agora,
        "exp": agora + 300,
        "email_verified": True,
        **extras,
    }
    return jwt.encode(claims, chave, algorithm="RS256")


class Cliente(APIClient):
    def como(self, usuario: Usuario) -> "Cliente":
        if not usuario.oidc_sub:
            usuario.oidc_sub = str(uuid.uuid4())
            usuario.save(update_fields=["oidc_sub"])
        self.credentials(
            HTTP_AUTHORIZATION=f"Bearer {emitir_token(sub=usuario.oidc_sub, email=usuario.email)}",
            HTTP_X_ITREE_ORIGEM="web",
        )
        return self


@pytest.fixture
def cliente() -> Cliente:
    return Cliente()


def criar_usuario(email: str, papeis=None, **extras) -> Usuario:
    return Usuario.objects.create(
        username=email, email=email, nome=email.split("@")[0], papeis=papeis or [], **extras
    )


@pytest.fixture
def admin(db) -> Usuario:
    return criar_usuario("admin@itree.teste", ["administrador"])


@pytest.fixture
def gestor(db) -> Usuario:
    return criar_usuario("gestor@itree.teste", ["gestor"])


def quadrado(x0, y0, lado=0.01) -> MultiPolygon:
    return MultiPolygon(Polygon.from_bbox((x0, y0, x0 + lado, y0 + lado)), srid=4326)


def criar_territorio(nome, tipo="bairro", geom=None, codigo=None) -> Territorio:
    return Territorio.objects.create(
        nome=nome,
        tipo=tipo,
        codigo=codigo or nome.lower(),
        geom=geom or quadrado(-38.55, -3.75),
        fonte="Teste",
        ingerido_em=timezone.now(),
    )
