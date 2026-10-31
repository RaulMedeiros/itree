#!/bin/sh
# Ponto de entrada do contêiner do backend.
#   api     — aplica migrações (se MIGRAR=1) e sobe o gunicorn
#   worker  — worker Celery
#   beat    — agendador Celery
#   manage  — executa um comando do manage.py (ex.: manage criar_administrador ...)
set -e

esperar_banco() {
  python - <<'PY'
import os, sys, time
import psycopg
from urllib.parse import urlparse
u = urlparse(os.environ["DATABASE_URL"])
for tentativa in range(60):
    try:
        psycopg.connect(host=u.hostname, port=u.port or 5432, user=u.username,
                        password=u.password, dbname=u.path.lstrip("/"), connect_timeout=3).close()
        sys.exit(0)
    except Exception as exc:
        print(f"Aguardando banco ({exc.__class__.__name__})...", flush=True)
        time.sleep(2)
sys.exit("Banco indisponível.")
PY
}

case "$1" in
  api)
    esperar_banco
    if [ "${MIGRAR:-0}" = "1" ]; then
      python manage.py migrate --noinput
      python manage.py preparar_armazenamento
    fi
    exec gunicorn config.wsgi:application \
      --bind 0.0.0.0:8000 \
      --workers "${GUNICORN_WORKERS:-3}" \
      --access-logfile - \
      --forwarded-allow-ips "*"
    ;;
  worker)
    esperar_banco
    exec celery -A config worker --loglevel "${LOG_LEVEL:-INFO}"
    ;;
  beat)
    esperar_banco
    exec celery -A config beat --loglevel "${LOG_LEVEL:-INFO}" --schedule /tmp/celerybeat-schedule
    ;;
  manage)
    shift
    exec python manage.py "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
