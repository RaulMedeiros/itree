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
  LIMITES_OFICIAIS=1
  # Arborização do entorno por bairro (IBGE, Censo 2022), cruzada pelo código IBGE.
  if curl -sf -m 180 --retry 4 --retry-all-errors "$CENSO" -o "$TMP/censo.zip"; then
    docker compose cp "$TMP/censo.zip" api:/tmp/telas-dados/censo-entorno.zip
    $M importar_censo_arborizacao --arquivo /tmp/telas-dados/censo-entorno.zip || true
  fi
  # População, renda e IDH por bairro (IBGE e SDE): o nome do arquivo do IBGE leva a data da revisão,
  # então vem da listagem do diretório, no host. Sem acesso, as telas novas ficam sem dado.
  IBGE_CENSO="https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022"
  IBGE_SETORES="$IBGE_CENSO/Agregados_por_Setores_Censitarios"
  atual() { curl -sf -m 60 --retry 3 "$1" | grep -o "href=\"$2\"" | sed 's/href="//;s/"//' | sort | tail -1; }
  BAS="$(atual "$IBGE_SETORES/Agregados_por_Bairro_csv/" 'Agregados_por_bairros_basico_BR_[0-9]*\.zip')"
  MUN="$(atual "$IBGE_SETORES/Agregados_por_Municipio_csv/" 'Agregados_por_municipios_basico_BR_[0-9]*\.zip')"
  REN="$(atual "$IBGE_CENSO/Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel/" 'Agregados_por_bairros_renda_responsavel_BR_[0-9]*_csv\.zip')"
  ANO_EST="$(curl -sf -m 60 --retry 3 https://ftp.ibge.gov.br/Estimativas_de_Populacao/ | grep -o 'href="Estimativas_[0-9]*/"' | grep -o '[0-9]\{4\}' | sort | tail -1)"
  EST="$(atual "https://ftp.ibge.gov.br/Estimativas_de_Populacao/Estimativas_$ANO_EST/" "POP${ANO_EST}_[0-9]*\.xlsx")"
  if [ -n "$BAS" ] && curl -sf -m 180 --retry 4 --retry-all-errors "$IBGE_SETORES/Agregados_por_Bairro_csv/$BAS" -o "$TMP/$BAS"; then
    docker compose cp "$TMP/$BAS" "api:/tmp/telas-dados/$BAS"
    ARQ_MUN=""
    if [ -n "$MUN" ] && curl -sf -m 180 --retry 4 --retry-all-errors "$IBGE_SETORES/Agregados_por_Municipio_csv/$MUN" -o "$TMP/$MUN"; then
      docker compose cp "$TMP/$MUN" "api:/tmp/telas-dados/$MUN"
      ARQ_MUN="--arquivo-municipio /tmp/telas-dados/$MUN"
    fi
    $M importar_populacao_censo --arquivo "/tmp/telas-dados/$BAS" $ARQ_MUN --ano 2022 || true
  fi
  if [ -n "$REN" ] && curl -sf -m 180 --retry 4 --retry-all-errors "$IBGE_CENSO/Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel/$REN" -o "$TMP/$REN"; then
    docker compose cp "$TMP/$REN" "api:/tmp/telas-dados/$REN"
    $M importar_renda_censo --arquivo "/tmp/telas-dados/$REN" --ano 2022 || true
  fi
  if [ -n "$EST" ] && curl -sf -m 180 --retry 4 --retry-all-errors "https://ftp.ibge.gov.br/Estimativas_de_Populacao/Estimativas_$ANO_EST/$EST" -o "$TMP/$EST"; then
    docker compose cp "$TMP/$EST" "api:/tmp/telas-dados/$EST"
    $M importar_estimativa_populacao --arquivo "/tmp/telas-dados/$EST" || true
  fi
  # IDH 2010 por bairro (SDE, via Fortaleza em Mapas, camada 35).
  if curl -sf -m 90 --retry 4 --retry-all-errors "${MAPAS}35" -o "$TMP/idh.geojson"; then
    docker compose cp "$TMP/idh.geojson" api:/tmp/telas-dados/idh-bairros.geojson
    $M importar_idh_bairros --arquivo /tmp/telas-dados/idh-bairros.geojson || true
  fi
else
  echo "Sem acesso ao Fortaleza em Mapas: usando bairros sintéticos."
  $M importar_territorios /tmp/telas-dados/bairros-sinteticos.geojson --tipo bairro \
    --campo-nome NOME --campo-codigo COD --fonte "Dados sintéticos de teste" --municipio "Município de teste"
  MUNICIPIO="Município de teste"
  LIMITES_OFICIAIS=0
fi
# Ilha de calor por bairro (UrbVerde, IAU-USP): o contêiner não tem rede externa, então o comando roda
# no host contra o banco do compose, depois dos limites oficiais. Os Termos de Uso da UrbVerde não são
# licença aberta, mas permitem uso acadêmico e não comercial com citação, que é o enquadramento do
# iTree (decisão de 21/11/2026, docs/decisoes/2026-11-21-rumo-do-produto.md): a demonstração grava os
# valores por padrão. Para só calcular, exporte URBVERDE_GRAVAR_VALORES=false. A
# camada do mapa (captura 43) não depende disso, mas o navegador do Playwright precisa alcançar
# urbverde.iau.usp.br.
if [ "$LIMITES_OFICIAIS" = 1 ]; then
  (cd "$RAIZ/backend" && DATABASE_URL=postgis://itree:itree@localhost:5432/itree \
    URBVERDE_GRAVAR_VALORES="${URBVERDE_GRAVAR_VALORES:-true}" \
    uv run python manage.py importar_ilha_calor_urbverde --bairros Aldeota Centro Messejana) \
    || echo "Ilha de calor por bairro não calculada."
fi
# Doação de mudas e plantio da URBFOR (CKAN de Fortaleza, cc-by-sa, 2022): três planilhas XLSX
# baixadas no host (o contêiner não tem rede externa) e importadas no banco do compose. O plantio
# lê o bairro do texto do endereço e por isso só entra com os limites oficiais. Sem rede, só avisa.
CKAN_URBFOR="https://dados.fortaleza.ce.gov.br/dataset/f0f8f2e4-1880-47bb-86d1-3e469e627498/resource"
if curl -sf -m 120 --retry 4 --retry-all-errors "$CKAN_URBFOR/7c894d24-cbe7-4683-b7a0-494d40bc642d/download/matriz-doacao-pf2022.xlsx" -o "$TMP/doacao-pf.xlsx" \
  && curl -sf -m 120 --retry 4 --retry-all-errors "$CKAN_URBFOR/8831df9e-f2de-414e-9697-d0c036a53b47/download/matriz-doacao-pj2022.xlsx" -o "$TMP/doacao-pj.xlsx" \
  && curl -sf -m 120 --retry 4 --retry-all-errors "$CKAN_URBFOR/7098bcbb-a6c3-4f37-bd56-1d565bacd377/download/matriz-plantio2022.xlsx" -o "$TMP/plantio.xlsx"; then
  for f in doacao-pf doacao-pj plantio; do
    docker compose cp "$TMP/$f.xlsx" "api:/tmp/telas-dados/$f.xlsx"
  done
  $M importar_doacao_mudas --arquivo-pf /tmp/telas-dados/doacao-pf.xlsx \
    --arquivo-pj /tmp/telas-dados/doacao-pj.xlsx || echo "Doação de mudas não importada."
  if [ "$LIMITES_OFICIAIS" = 1 ]; then
    $M importar_plantio_urbfor --arquivo /tmp/telas-dados/plantio.xlsx || echo "Plantio não importado."
  else
    echo "Sem os limites oficiais: o plantio por bairro não foi importado."
  fi
else
  echo "Sem acesso ao CKAN de Fortaleza: a captura de mudas doadas (41) fica sem dados."
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
# Iluminação pública (SEINF, dados abertos da prefeitura, CC BY-SA). O contêiner não tem rede
# externa: o XLSX (16 MB) é baixado no host e copiado, como os limites oficiais. Sem acesso, só
# avisa: as capturas 39 e 40 ficam sem pontos. Depois, algumas árvores SINTÉTICAS são postas perto
# de postes reais para a captura 40 mostrar a lista (ver semear_iluminacao.py).
ILUMINACAO="https://dados.fortaleza.ce.gov.br/dataset/b21546fe-784c-4d9c-87cf-733f67a4056c/resource/9f933d1c-5642-4545-a247-83cdd0375715/download/relatoriodoparquedeiluminacaopublica.xlsx"
TMP_ILUM="$(mktemp -d)"
if curl -sf -m 300 --retry 4 --retry-all-errors "$ILUMINACAO" -o "$TMP_ILUM/iluminacao.xlsx"; then
  docker compose cp "$TMP_ILUM/iluminacao.xlsx" api:/tmp/telas-dados/iluminacao.xlsx
  docker compose cp "$AQUI/semear_iluminacao.py" api:/tmp/telas-dados/semear_iluminacao.py
  ($M importar_iluminacao_publica --arquivo /tmp/telas-dados/iluminacao.xlsx \
    && $M shell -c "exec(open('/tmp/telas-dados/semear_iluminacao.py').read())") \
    || echo "Iluminação pública não importada: as capturas 39 e 40 ficam sem pontos."
else
  echo "Sem acesso ao portal de dados abertos da prefeitura: a iluminação pública não foi importada (capturas 39 e 40 sem pontos)."
fi
rm -rf "$TMP_ILUM"
# Referências das espécies (Wikidata, Wikipedia, Commons e, para imagem, GBIF). O
# contêiner não tem rede externa: o comando roda no host, contra o banco do compose,
# quando o host alcançar o Wikidata ou o GBIF. Wikidata com limite de taxa (429) não
# trava: as tentativas têm espera crescente e a espécie em erro cai para o GBIF.
if curl -sf -m 15 "https://api.gbif.org/v1/species/match?name=Licania%20tomentosa" >/dev/null \
  || curl -sf -m 15 "https://www.wikidata.org/w/api.php?action=query&format=json" >/dev/null; then
  (cd "$RAIZ/backend" && DATABASE_URL=postgis://itree:itree@localhost:5432/itree \
    uv run python manage.py atualizar_referencias_especies --todas) \
    || echo "Referências das espécies não atualizadas."
else
  echo "Sem acesso ao Wikidata e ao GBIF a partir do host: as capturas do catálogo mostram o marcador \"Sem imagem de referência\"; rode atualizar_referencias_especies onde houver acesso."
fi
# Áreas verdes oficiais (Fortaleza em Mapas). O contêiner não tem acesso à rede
# externa; o comando roda no host, contra o banco do compose, quando houver acesso.
if curl -sf -m 15 "https://mapas.fortaleza.ce.gov.br/api/v1/maps" >/dev/null; then
  (cd "$RAIZ/backend" && DATABASE_URL=postgis://itree:itree@localhost:5432/itree \
    uv run python manage.py importar_areas_verdes) || echo "Áreas verdes não importadas."
  # Adoção de praças (mapa 622): baixada no host e importada depois das praças, que ela liga ao
  # ponto mais próximo a até 50 m. O nome do adotante é descartado na leitura.
  ADOCAO="$(mktemp)"
  if curl -sf -m 90 --retry 4 --retry-all-errors "${MAPAS}622" -o "$ADOCAO"; then
    (cd "$RAIZ/backend" && DATABASE_URL=postgis://itree:itree@localhost:5432/itree \
      uv run python manage.py importar_adocao_pracas --arquivo "$ADOCAO") || echo "Adoção de praças não importada."
  else
    echo "Sem acesso ao mapa 622: as praças não aparecem como adotadas nas capturas."
  fi
  rm -f "$ADOCAO"
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
