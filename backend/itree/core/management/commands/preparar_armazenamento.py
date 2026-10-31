"""Cria o bucket privado e configura CORS para uploads diretos do navegador.
Idempotente; não faz nada se o armazenamento S3 não estiver configurado."""

from django.conf import settings
from django.core.management.base import BaseCommand

from itree.core.armazenamento import cliente_interno, s3_configurado


class Command(BaseCommand):
    help = "Prepara o bucket de arquivos (criação e CORS)."

    def handle(self, *args, **opts):
        if not s3_configurado():
            self.stdout.write("Armazenamento S3 não configurado; nada a fazer.")
            return
        s3 = cliente_interno()
        bucket = settings.S3_BUCKET
        existentes = {b["Name"] for b in s3.list_buckets().get("Buckets", [])}
        if bucket not in existentes:
            s3.create_bucket(Bucket=bucket)
            self.stdout.write(f"Bucket {bucket} criado.")
        origens = list(settings.CORS_ALLOWED_ORIGINS)
        if origens:
            try:
                s3.put_bucket_cors(
                    Bucket=bucket,
                    CORSConfiguration={
                        "CORSRules": [
                            {
                                "AllowedOrigins": origens,
                                "AllowedMethods": ["GET", "PUT", "HEAD"],
                                "AllowedHeaders": ["*"],
                                "ExposeHeaders": ["ETag"],
                                "MaxAgeSeconds": 3600,
                            }
                        ]
                    },
                )
            except s3.exceptions.ClientError as exc:
                self.stderr.write(f"Não foi possível configurar CORS do bucket: {exc}")
        self.stdout.write(self.style.SUCCESS(f"Armazenamento pronto (bucket {bucket})."))
