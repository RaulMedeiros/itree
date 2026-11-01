import uuid

from rest_framework.exceptions import ValidationError


def uuid_do_parametro(valor: str, nome: str) -> uuid.UUID:
    """Converte parâmetro de consulta em UUID ou responde 400 (nunca 500)."""
    try:
        return uuid.UUID(str(valor))
    except ValueError as exc:
        raise ValidationError({nome: "Identificador inválido."}) from exc
