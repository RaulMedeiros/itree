from django.db import migrations

from itree.core.sequencias import sql_criar_sequencia


class Migration(migrations.Migration):
    dependencies = [("ocorrencias", "0001_initial")]

    operations = [migrations.RunSQL(*sql_criar_sequencia("ocorrencias_ocorrencia_numero_seq"))]
