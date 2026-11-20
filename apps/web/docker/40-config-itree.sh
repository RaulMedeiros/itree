#!/bin/sh
# Gera /config.js com a configuração do painel a partir do ambiente.
set -e

# Texto seguro dentro de uma string JS entre aspas duplas.
js() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# Mapa base de satélite: sem ITREE_MAPA_SATELITE_URL, a opção "Satélite" não aparece.
SATELITE=null
if [ -n "${ITREE_MAPA_SATELITE_URL:-}" ]; then
  SATELITE="{
    url: \"$(js "$ITREE_MAPA_SATELITE_URL")\",
    nome: \"$(js "${ITREE_MAPA_SATELITE_NOME:-}")\",
    atribuicao: \"$(js "${ITREE_MAPA_SATELITE_ATRIBUICAO:-}")\",
    zoomMaximo: ${ITREE_MAPA_SATELITE_ZOOM_MAXIMO:-19},
    data: \"$(js "${ITREE_MAPA_SATELITE_DATA:-}")\",
    aviso: \"$(js "${ITREE_MAPA_SATELITE_AVISO:-}")\"
  }"
fi

cat > /usr/share/nginx/html/config.js <<JS
window.__ITREE_CONFIG__ = {
  urlApi: "${ITREE_URL_API:-}",
  oidcAuthority: "${ITREE_OIDC_AUTHORITY:?defina ITREE_OIDC_AUTHORITY}",
  oidcClientId: "${ITREE_OIDC_CLIENT_ID:-itree-web}",
  mostrarModulosFuturos: ${ITREE_MOSTRAR_MODULOS_FUTUROS:-false},
  mapaSatelite: ${SATELITE}
};
JS
