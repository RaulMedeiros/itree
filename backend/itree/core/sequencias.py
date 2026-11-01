"""Números legíveis por pessoas (ex.: ARV-000123), gerados por sequências do
PostgreSQL. O identificador real continua sendo o UUIDv7."""

from django.db import connection


def proximo_numero(sequencia: str) -> int:
    with connection.cursor() as cursor:
        cursor.execute("SELECT nextval(%s)", [sequencia])
        return cursor.fetchone()[0]


def sql_criar_sequencia(nome: str) -> tuple[str, str]:
    return (f"CREATE SEQUENCE IF NOT EXISTS {nome}", f"DROP SEQUENCE IF EXISTS {nome}")
