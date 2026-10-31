/**
 * Configuração do painel. Em contêiner, vem de `/config.js`, gerado na
 * inicialização a partir de variáveis de ambiente (a mesma imagem serve
 * qualquer ambiente). Em desenvolvimento, cai nas variáveis VITE_*.
 */
interface ConfiguracaoExecucao {
  urlApi?: string;
  oidcAuthority?: string;
  oidcClientId?: string;
  mostrarModulosFuturos?: boolean;
}

declare global {
  interface Window {
    __ITREE_CONFIG__?: ConfiguracaoExecucao;
  }
}

const execucao: ConfiguracaoExecucao = window.__ITREE_CONFIG__ ?? {};
const env = import.meta.env;

export const config = {
  urlApi: execucao.urlApi ?? env.VITE_API_URL ?? "",
  oidc: {
    authority:
      execucao.oidcAuthority ?? env.VITE_OIDC_AUTHORITY ?? "http://localhost:8080/realms/itree",
    clientId: execucao.oidcClientId ?? env.VITE_OIDC_CLIENT_ID ?? "itree-web",
  },
  mostrarModulosFuturos:
    execucao.mostrarModulosFuturos ?? env.VITE_MOSTRAR_MODULOS_FUTUROS === "true",
};
