from django.apps import AppConfig


class ContasConfig(AppConfig):
    name = "itree.contas"
    label = "contas"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self) -> None:
        from . import autenticacao  # noqa: F401 - registra extensão OpenAPI
