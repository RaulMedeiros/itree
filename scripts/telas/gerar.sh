#!/bin/bash
# Recria a pilha local com dados sintéticos e captura as telas em docs/telas/.
#
# ATENÇÃO: apaga os volumes do compose (banco e arquivos do ambiente local).
# Pré-requisitos: imagens itree/api:dev e itree/web:dev construídas
# (docker compose --profile completo build) e Node com Playwright instalado.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
cd "$RAIZ/infra/docker"

docker compose --profile completo down -v
docker compose --profile completo up -d --no-build
until curl -sf http://localhost:8080/realms/itree/.well-known/openid-configuration >/dev/null; do sleep 3; done
until curl -sf http://localhost:8088/api/v1/saude >/dev/null; do sleep 3; done

M="docker compose exec -T api /app/docker/entrypoint.sh manage"
docker compose exec -T api mkdir -p /tmp/telas-dados
for f in bairros-sinteticos.geojson focos-sinteticos.csv deter-sintetico.geojson semear.py ids.py; do
  docker compose cp "$AQUI/$f" "api:/tmp/telas-dados/$f"
done

$M importar_territorios /tmp/telas-dados/bairros-sinteticos.geojson --tipo bairro \
  --campo-nome NOME --campo-codigo COD --fonte "Dados sintéticos de teste" --municipio "Município de teste"
$M criar_administrador --email admin@itree.local --nome "Ana Administradora" --territorio "Município de teste"
$M shell -c "
from itree.contas.models import Usuario, EscopoUsuario
from itree.territorio.models import Territorio
u = Usuario.objects.create(email='gestor@itree.local', username='gestor@itree.local', nome='Gabriel Gestor',
                           papeis=['gestor', 'revisor'], registro_profissional='CREA-CE 12345')
EscopoUsuario.objects.create(usuario=u, territorio=Territorio.objects.get(tipo='municipio'))
"
$M shell -c "exec(open('/tmp/telas-dados/semear.py').read())"
$M shell -c "exec(open('/tmp/telas-dados/ids.py').read())" | tail -1 > /tmp/telas-ids.json

node "$AQUI/capturar.js" /tmp/telas-ids.json "$RAIZ/docs/telas"
