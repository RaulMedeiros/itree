from django.db import migrations

from itree.core.sequencias import sql_criar_sequencia


class Migration(migrations.Migration):
    dependencies = [("inventario", "0001_initial")]

    operations = [
        migrations.RunSQL(*sql_criar_sequencia("inventario_arvore_numero_seq")),
        migrations.RunSQL(*sql_criar_sequencia("inventario_lote_numero_seq")),
    ]
