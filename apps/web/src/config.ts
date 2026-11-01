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
  /** Mapas base. O provedor oficial ainda é decisão pendente (DP-07). */
  mapaRuas?: CamadaBase | null;
  mapaSatelite?: CamadaBase | null;
}

export interface CamadaBase {
  /** URL de tiles raster com {z}/{x}/{y}. */
  url: string;
  atribuicao: string;
  /** Data da imagem, quando o provedor informa (RF-MAPA-002). */
  data?: string;
  tamanho?: number;
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
  mapaRuas:
    execucao.mapaRuas === undefined
      ? {
          // Padrão de desenvolvimento. Os tiles públicos do OSM não servem para uso em
          // produção (política de uso); defina o provedor oficial (DP-07).
          url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          atribuicao: "© colaboradores do OpenStreetMap",
          tamanho: 256,
        }
      : execucao.mapaRuas,
  mapaSatelite: execucao.mapaSatelite ?? null,
};
