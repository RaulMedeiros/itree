from django.db import migrations

from itree.core.sequencias import sql_criar_sequencia


class Migration(migrations.Migration):
    dependencies = [("inspecoes", "0002_initial")]

    operations = [migrations.RunSQL(*sql_criar_sequencia("inspecoes_inspecao_numero_seq"))]
