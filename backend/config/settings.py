"""Configuração do backend. Todos os valores sensíveis ou de ambiente vêm de
variáveis de ambiente (ver ``.env.example``)."""

from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env", overwrite=False)

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# Ambiente: desenvolvimento | homologacao | demonstracao | producao (RNF-OPS-001).
# Em "demonstracao" a API sinaliza que os dados são fictícios (RN-PROV-008).
AMBIENTE = env.str("ITREE_AMBIENTE", default="desenvolvimento")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
    "corsheaders",
    "rest_framework",
    "drf_spectacular",
    "pgtrigger",
    "pghistory",
    "itree.core",
    "itree.territorio",
    "itree.contas",
    "itree.auditoria",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "itree.auditoria.middleware.AuditoriaMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": env.db_url("DATABASE_URL", default="postgis://itree:itree@localhost:5432/itree")
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "contas.Usuario"

LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Fortaleza"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# --- Armazenamento de arquivos (S3-compatível; ADR-0001) --------------------
if env.str("S3_BUCKET", default=""):
    STORAGES = {
        "default": {
            "BACKEND": "storages.backends.s3.S3Storage",
            "OPTIONS": {
                "bucket_name": env.str("S3_BUCKET"),
                "endpoint_url": env.str("S3_ENDPOINT_URL", default=None),
                "access_key": env.str("S3_ACCESS_KEY_ID", default=None),
                "secret_key": env.str("S3_SECRET_ACCESS_KEY", default=None),
                "region_name": env.str("S3_REGION", default=None),
                "default_acl": None,
                "querystring_auth": True,
                "querystring_expire": 300,
                "file_overwrite": False,
            },
        },
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }

# --- Autenticação OIDC (Keycloak; RF-ACL-001) -------------------------------
OIDC_ISSUER = env.str("OIDC_ISSUER", default="http://localhost:8080/realms/itree")
OIDC_JWKS_URL = env.str("OIDC_JWKS_URL", default=f"{OIDC_ISSUER}/protocol/openid-connect/certs")
OIDC_AUDIENCE = env.str("OIDC_AUDIENCE", default="itree-api")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["itree.contas.autenticacao.OIDCAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "itree.core.paginacao.Paginacao",
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "UNAUTHENTICATED_USER": None,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Engine de Inteligência Arbórea — API",
    "DESCRIPTION": "API do painel web e do aplicativo de campo.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": r"/api/v1(/admin)?",
    "COMPONENT_SPLIT_REQUEST": True,
    "ENUM_NAME_OVERRIDES": {
        "PapelEnum": "itree.contas.permissoes.Papel",
        "PermissaoEnum": "itree.contas.permissoes.Permissao",
        "TipoTerritorioEnum": "itree.territorio.models.TipoTerritorio",
    },
}

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:5173"])
CORS_ALLOW_HEADERS = (
    "accept",
    "authorization",
    "content-type",
    "x-itree-origem",
)

# --- Auditoria (RN-PROV-002, RNF-SEG-004) -----------------------------------
PGHISTORY_APPEND_ONLY = True
PGHISTORY_MIDDLEWARE_METHODS = ("POST", "PUT", "PATCH", "DELETE")

# --- Celery -----------------------------------------------------------------
CELERY_BROKER_URL = env.str("REDIS_URL", default="redis://localhost:6379/0")
CELERY_TIMEZONE = TIME_ZONE

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env.str("LOG_LEVEL", default="INFO")},
}
