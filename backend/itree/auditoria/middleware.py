from pghistory.middleware import HistoryMiddleware

ORIGENS_VALIDAS = {"web", "app"}


class AuditoriaMiddleware(HistoryMiddleware):
    """Anexa ao contexto de auditoria: usuário (definido após a autenticação
    DRF), URL, método e origem do canal (RN-PROV-002).

    A origem informada pelo cliente em ``X-Itree-Origem`` só é aceita se for um
    valor conhecido; caso contrário é registrada como ``api``.
    """

    def get_context(self, request):
        contexto = super().get_context(request)
        origem = request.headers.get("X-Itree-Origem", "").strip().lower()
        contexto["origem"] = origem if origem in ORIGENS_VALIDAS else "api"
        contexto["metodo"] = request.method
        return contexto
