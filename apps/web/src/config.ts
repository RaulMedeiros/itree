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
  /** Mapas base. O provedor oficial ainda é decisão pendente (DP-07, DP-21). */
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
  /** Nome do provedor ou da imagem, para o seletor e a atribuição. */
  nome?: string;
  /**
   * Maior zoom em que o provedor tem imagem de verdade. Além dele o mapa só amplia (sobreamostra)
   * a imagem, em vez de pedir tiles que são a mesma imagem borrada.
   */
  zoomMaximo?: number;
  /** Aviso de resolução, mostrado ao lado do seletor ("imagem de 10 m: ..."). */
  aviso?: string;
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
  // Sem configuração não há opção "Satélite": o provedor de produção é a DP-21.
  mapaSatelite: execucao.mapaSatelite ?? satelitePorVariaveis(),
};

/** Satélite configurado pelas variáveis VITE_MAPA_SATELITE_* (desenvolvimento, sem /config.js). */
function satelitePorVariaveis(): CamadaBase | null {
  const url = env.VITE_MAPA_SATELITE_URL;
  if (!url) return null;
  const zoom = Number(env.VITE_MAPA_SATELITE_ZOOM_MAXIMO);
  return {
    url,
    atribuicao: env.VITE_MAPA_SATELITE_ATRIBUICAO ?? "",
    nome: env.VITE_MAPA_SATELITE_NOME || undefined,
    zoomMaximo: Number.isFinite(zoom) && zoom > 0 ? zoom : undefined,
    aviso: env.VITE_MAPA_SATELITE_AVISO || undefined,
    data: env.VITE_MAPA_SATELITE_DATA || undefined,
  };
}
