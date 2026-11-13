"""O padrão de EMAIL_BACKEND: console só com DEBUG; SMTP fora dele."""

import importlib.util
from pathlib import Path

import pytest

CONSOLE = "django.core.mail.backends.console.EmailBackend"
SMTP = "django.core.mail.backends.smtp.EmailBackend"


def carregar_settings(monkeypatch, debug: str, backend: str | None = None):
    """Executa config/settings.py de novo, sob variáveis de ambiente controladas."""
    monkeypatch.setenv("DJANGO_DEBUG", debug)
    monkeypatch.delenv("EMAIL_BACKEND", raising=False)
    if backend:
        monkeypatch.setenv("EMAIL_BACKEND", backend)
    caminho = Path(__file__).resolve().parent.parent / "config" / "settings.py"
    spec = importlib.util.spec_from_file_location("config.settings_email_teste", caminho)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


@pytest.mark.parametrize(
    ("debug", "esperado"), [("true", CONSOLE), ("false", SMTP)], ids=["com_debug", "sem_debug"]
)
def test_padrao_do_backend_de_email(monkeypatch, debug, esperado):
    assert carregar_settings(monkeypatch, debug).EMAIL_BACKEND == esperado


def test_email_backend_explicito_vale_com_ou_sem_debug(monkeypatch):
    for debug in ("true", "false"):
        assert carregar_settings(monkeypatch, debug, CONSOLE).EMAIL_BACKEND == CONSOLE


def test_smtp_usa_tls_por_padrao(monkeypatch):
    """Sem EMAIL_USE_TLS definido, a senha do SMTP não trafega em texto claro."""
    monkeypatch.delenv("EMAIL_USE_TLS", raising=False)
    assert carregar_settings(monkeypatch, "false").EMAIL_USE_TLS is True
