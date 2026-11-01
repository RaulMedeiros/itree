"""Acesso direto ao armazenamento S3-compatível (URLs pré-assinadas, bucket)."""

from functools import lru_cache

import boto3
from botocore.config import Config
from django.conf import settings


def s3_configurado() -> bool:
    return bool(settings.S3_BUCKET)


def _cliente(endpoint: str | None):
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.S3_ACCESS_KEY_ID,
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
        region_name=settings.S3_REGION,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


@lru_cache(maxsize=1)
def cliente_interno():
    """Cliente usado pelos contêineres (endereço interno)."""
    return _cliente(settings.S3_ENDPOINT_URL)


@lru_cache(maxsize=1)
def cliente_publico():
    """Cliente usado só para assinar URLs que o navegador vai acessar."""
    return _cliente(settings.S3_ENDPOINT_URL_PUBLICO)


def url_upload(chave: str, tipo_conteudo: str, tamanho: int, expira: int = 300) -> str:
    """URL de PUT que só aceita exatamente ``tamanho`` bytes: o Content-Length
    entra na assinatura, e o armazenamento recusa corpo de outro tamanho."""
    return cliente_publico().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.S3_BUCKET,
            "Key": chave,
            "ContentType": tipo_conteudo,
            "ContentLength": tamanho,
        },
        ExpiresIn=expira,
    )


def url_download(chave: str, expira: int = 300) -> str:
    return cliente_publico().generate_presigned_url(
        "get_object", Params={"Bucket": settings.S3_BUCKET, "Key": chave}, ExpiresIn=expira
    )


def metadados(chave: str) -> dict | None:
    try:
        return cliente_interno().head_object(Bucket=settings.S3_BUCKET, Key=chave)
    except cliente_interno().exceptions.ClientError:
        return None


def apagar(chave: str) -> None:
    cliente_interno().delete_object(Bucket=settings.S3_BUCKET, Key=chave)
