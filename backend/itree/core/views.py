from django.conf import settings
from django.db import connection
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response


@extend_schema(
    operation_id="saude",
    responses=inline_serializer(
        "Saude",
        {
            "status": serializers.CharField(),
            "banco": serializers.CharField(),
            "ambiente": serializers.CharField(),
        },
    ),
)
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def saude(request: Request) -> Response:
    """Verificação de saúde para orquestradores e monitoramento."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        banco = "ok"
    except Exception:  # noqa: BLE001 - qualquer falha de banco é reportada
        banco = "indisponivel"
    status = 200 if banco == "ok" else 503
    return Response(
        {
            "status": "ok" if status == 200 else "degradado",
            "banco": banco,
            "ambiente": settings.AMBIENTE,
        },
        status=status,
    )
