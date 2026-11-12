"""Apoio aos testes da trilha de auditoria, que devolve grupos de eventos."""


def eventos_de(corpo: dict) -> list[dict]:
    """Eventos da página, na ordem da trilha, sem os grupos."""
    return [ev for grupo in corpo["results"] for ev in grupo["eventos"]]
