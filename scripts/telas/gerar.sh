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

# Os dados das capturas são sintéticos: a pilha sobe em ambiente de demonstração, para a
# API declarar isso e o painel exibir a faixa de aviso (sobreposição, sem mudar o compose padrão).
export COMPOSE_FILE="compose.yml:compose.demonstracao.yml"

docker compose --profile completo down -v
docker compose --profile completo up -d --no-build
until curl -sf http://localhost:8080/realms/itree/.well-known/openid-configuration >/dev/null; do sleep 3; done
until curl -sf http://localhost:8088/api/v1/saude >/dev/null; do sleep 3; done

M="docker compose exec -T api /app/docker/entrypoint.sh manage"
docker compose exec -T api mkdir -p /tmp/telas-dados
for f in bairros-sinteticos.geojson focos-sinteticos.csv deter-sintetico.geojson semear.py ids.py; do
  docker compose cp "$AQUI/$f" "api:/tmp/telas-dados/$f"
done

# Limites oficiais de Fortaleza (Fortaleza em Mapas, Ipplan: 12 regionais e 121
# bairros com código IBGE). O contêiner não tem rede externa: os arquivos são
# baixados no host. Sem acesso, ficam os três bairros sintéticos de antes.
MAPAS="https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id="
CENSO="https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Caracteristicas_urbanisticas_do_entorno_dos_domicilios/Agregados_por_Bairro_csv/Agregados_por_bairros_entorno_faces_BR.zip"
TMP="$(mktemp -d)"
if curl -sf -m 90 --retry 4 --retry-all-errors "${MAPAS}17" -o "$TMP/regionais.geojson" && curl -sf -m 90 --retry 4 --retry-all-errors "${MAPAS}21" -o "$TMP/bairros.geojson"; then
  docker compose cp "$TMP/regionais.geojson" api:/tmp/telas-dados/regionais-oficiais.geojson
  docker compose cp "$TMP/bairros.geojson" api:/tmp/telas-dados/bairros-oficiais.geojson
  $M importar_limites_fortaleza --arquivo-regionais /tmp/telas-dados/regionais-oficiais.geojson \
    --arquivo-bairros /tmp/telas-dados/bairros-oficiais.geojson --municipio Fortaleza
  MUNICIPIO="Fortaleza"
  # Arborização do entorno por bairro (IBGE, Censo 2022), cruzada pelo código IBGE.
  if curl -sf -m 180 --retry 4 --retry-all-errors "$CENSO" -o "$TMP/censo.zip"; then
    docker compose cp "$TMP/censo.zip" api:/tmp/telas-dados/censo-entorno.zip
    $M importar_censo_arborizacao --arquivo /tmp/telas-dados/censo-entorno.zip || true
  fi
else
  echo "Sem acesso ao Fortaleza em Mapas: usando bairros sintéticos."
  $M importar_territorios /tmp/telas-dados/bairros-sinteticos.geojson --tipo bairro \
    --campo-nome NOME --campo-codigo COD --fonte "Dados sintéticos de teste" --municipio "Município de teste"
  MUNICIPIO="Município de teste"
fi
rm -rf "$TMP"
$M criar_administrador --email admin@itree.local --nome "Ana Administradora" --territorio "$MUNICIPIO"
$M shell -c "
from itree.contas.models import Usuario, EscopoUsuario
from itree.territorio.models import Territorio
u = Usuario.objects.create(email='gestor@itree.local', username='gestor@itree.local', nome='Gabriel Gestor',
                           papeis=['gestor', 'revisor'], registro_profissional='CREA-CE 12345')
EscopoUsuario.objects.create(usuario=u, territorio=Territorio.objects.get(tipo='municipio'))
"
$M shell -c "exec(open('/tmp/telas-dados/semear.py').read())"
# Referências das espécies (Wikidata/Wikipedia/Commons), quando houver acesso.
if docker compose exec -T api python -c "import urllib.request; urllib.request.urlopen('https://www.wikidata.org/w/api.php?action=query&format=json', timeout=10)" >/dev/null 2>&1; then
  $M atualizar_referencias_especies
else
  echo "Sem acesso ao Wikidata a partir do contêiner: rode atualizar_referencias_especies onde houver acesso."
fi
# Áreas verdes oficiais (Fortaleza em Mapas). O contêiner não tem acesso à rede
# externa; o comando roda no host, contra o banco do compose, quando houver acesso.
if curl -sf -m 15 "https://mapas.fortaleza.ce.gov.br/api/v1/maps" >/dev/null; then
  (cd "$RAIZ/backend" && DATABASE_URL=postgis://itree:itree@localhost:5432/itree \
    uv run python manage.py importar_areas_verdes) || echo "Áreas verdes não importadas."
  # Conector de exemplo (Atendimentos do Plano de Arborização, id 534) como camada de
  # referência, sincronizado uma vez no host. Não é inventário e não cria árvores.
  (cd "$RAIZ/backend" && DATABASE_URL=postgis://itree:itree@localhost:5432/itree \
    uv run python manage.py criar_conectores_exemplo && \
    DATABASE_URL=postgis://itree:itree@localhost:5432/itree uv run python manage.py shell -c "
from itree.conectores import servico
from itree.conectores.models import Conector
for c in Conector.objects.all():
    c.ativo = True
    c.save(update_fields=['ativo'])
    print(c.nome, servico.executar(servico.iniciar_execucao(c)).sucesso)
") || echo "Conector de exemplo não sincronizado."
else
  echo "Sem acesso ao Fortaleza em Mapas: a camada de áreas verdes fica vazia nas capturas."
fi
$M shell -c "exec(open('/tmp/telas-dados/ids.py').read())" | tail -1 > /tmp/telas-ids.json

node "$AQUI/capturar.js" /tmp/telas-ids.json "$RAIZ/docs/telas"
