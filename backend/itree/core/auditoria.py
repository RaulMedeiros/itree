import pghistory


def eventos() -> tuple:
    """Rastreadores de auditoria (criação, alteração, exclusão).
    Cada modelo precisa de instâncias próprias."""
    return (pghistory.InsertEvent(), pghistory.UpdateEvent(), pghistory.DeleteEvent())
