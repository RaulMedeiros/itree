#!/bin/sh
# Gera /config.js com a configuração do painel a partir do ambiente.
set -e
cat > /usr/share/nginx/html/config.js <<JS
window.__ITREE_CONFIG__ = {
  urlApi: "${ITREE_URL_API:-}",
  oidcAuthority: "${ITREE_OIDC_AUTHORITY:?defina ITREE_OIDC_AUTHORITY}",
  oidcClientId: "${ITREE_OIDC_CLIENT_ID:-itree-web}",
  mostrarModulosFuturos: ${ITREE_MOSTRAR_MODULOS_FUTUROS:-false}
};
JS
