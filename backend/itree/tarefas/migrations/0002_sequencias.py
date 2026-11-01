from django.db import migrations

from itree.core.sequencias import sql_criar_sequencia


class Migration(migrations.Migration):
    dependencies = [("tarefas", "0001_initial")]

    operations = [migrations.RunSQL(*sql_criar_sequencia("tarefas_tarefa_numero_seq"))]
