import { configurarCliente } from "@itree/api-client";
import { UserManager, WebStorageStateStore } from "oidc-client-ts";

import { config } from "../config";

/**
 * Login via OIDC (Keycloak) com Authorization Code + PKCE (RF-ACL-001).
 * O token fica em sessionStorage e é renovado silenciosamente.
 */
export const gerenciadorUsuario = new UserManager({
  authority: config.oidc.authority,
  client_id: config.oidc.clientId,
  redirect_uri: `${window.location.origin}/`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  scope: "openid profile email",
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
});

configurarCliente({
  urlBase: config.urlApi,
  origem: "web",
  obterToken: async () => (await gerenciadorUsuario.getUser())?.access_token,
  aoNaoAutenticado: () => {
    void gerenciadorUsuario.signinRedirect({
      state: window.location.pathname + window.location.search,
    });
  },
});
