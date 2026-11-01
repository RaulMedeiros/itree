from django.db import migrations

from itree.core.sequencias import sql_criar_sequencia


class Migration(migrations.Migration):
    dependencies = [("alertas", "0001_initial")]

    operations = [migrations.RunSQL(*sql_criar_sequencia("alertas_alerta_numero_seq"))]
