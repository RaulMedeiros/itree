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


# --- Cenário territorial da F1 -------------------------------------------------

from itree.contas.models import EscopoUsuario  # noqa: E402
from itree.ocorrencias.models import TipoOcorrencia  # noqa: E402


@pytest.fixture
def territorios(db):
    """Município de teste com dois bairros lado a lado (A a oeste, B a leste)."""
    municipio = criar_territorio("Município", tipo="municipio", geom=quadrado(-38.60, -3.80, 0.2))
    a = criar_territorio("Bairro A", geom=quadrado(-38.56, -3.76, 0.01))
    b = criar_territorio("Bairro B", geom=quadrado(-38.54, -3.76, 0.01))
    return {"municipio": municipio, "a": a, "b": b}


# Pontos dentro de cada bairro.
PONTO_A = {"longitude": -38.555, "latitude": -3.755}
PONTO_B = {"longitude": -38.535, "latitude": -3.755}


def com_escopo(usuario, *territorios_):
    for t in territorios_:
        EscopoUsuario.objects.create(usuario=usuario, territorio=t)
    return usuario


@pytest.fixture
def revisor(territorios):
    return com_escopo(
        criar_usuario("revisor@itree.teste", ["revisor"], registro_profissional="CREA 123"),
        territorios["municipio"],
    )


@pytest.fixture
def tecnico_a(territorios):
    """Técnico com escopo apenas no Bairro A."""
    return com_escopo(criar_usuario("tecnico@itree.teste", ["tecnico"]), territorios["a"])


@pytest.fixture
def gestor_municipal(territorios):
    return com_escopo(criar_usuario("gm@itree.teste", ["gestor"]), territorios["municipio"])


@pytest.fixture
def tipo_queda(db):
    return TipoOcorrencia.objects.create(nome="Galho caído", prazo_padrao_dias=3)
