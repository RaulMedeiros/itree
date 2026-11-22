/**
 * Camadas de contexto de imóveis e uso do solo, todas desligadas por padrão e sem baixar nada antes
 * de ligar:
 *
 * - "Edificações": contornos do Google Open Buildings v3 (CC BY 4.0), em vector tiles da API, só a
 *   partir do zoom 15 (são centenas de milhares de polígonos);
 * - "Uso predominante por lote (SEFIN, 2022)": raster WMS do Fortaleza em Mapas (as 12 camadas
 *   regionais num só pedido), residencial, não residencial, misto ou territorial pela regra dos 70%;
 * - "Macrozoneamento": zonas da SEUMA (2022), em vector tiles da API.
 */
import type { Map as MapaMapLibre } from "maplibre-gl";

import { urlApi } from "./url";

/** Mesmo valor de `ZOOM_EDIFICACOES` em `itree/mapa/views.py`. */
export const ZOOM_EDIFICACOES = 15;

export const CAMADAS_EDIFICACOES = ["edificacoes-preenchimento", "edificacoes-contorno"];
export const CAMADAS_USO_LOTE = ["uso-lote-wms"];
export const CAMADAS_MACROZONEAMENTO = [
  "macrozoneamento-preenchimento",
  "macrozoneamento-contorno",
];

export const ATRIBUICAO_EDIFICACOES = "Google Open Buildings v3 (CC BY 4.0)";
export const ATRIBUICAO_USO_LOTE = "SEFIN, uso predominante por lote, 2022 (Fortaleza em Mapas)";
export const ATRIBUICAO_MACROZONEAMENTO =
  "SEUMA, Macrozoneamento Urbano de Fortaleza, 2022 (Fortaleza em Mapas)";

const OWS = "https://mapas.fortaleza.ce.gov.br/api/v1/ows";
const CAMADAS_WMS_USO = Array.from({ length: 12 }, (_, i) => `vw_UsoPorLoteSER${i + 1}`).join(",");

/** Modelo de URL dos tiles do WMS de uso por lote (o MapLibre troca `{bbox-epsg-3857}`). */
export const URL_TILES_USO_LOTE =
  `${OWS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${CAMADAS_WMS_USO}&STYLES=` +
  "&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true";

/** Legenda oficial do WMS (uma camada regional serve: o estilo é o mesmo). */
export const URL_LEGENDA_USO_LOTE = `${OWS}?SERVICE=WMS&REQUEST=GetLegendGraphic&VERSION=1.1.1&FORMAT=image/png&LAYER=vw_UsoPorLoteSER2`;

/** Cores das zonas do macrozoneamento por tipo de zona (a sigla vem da API). */
export const CORES_MACROZONAS: [string, string][] = [
  ["ZOP", "#8e6bbf"],
  ["ZOC", "#5b7fa6"],
  ["ZRU", "#b9803c"],
  ["ZOM", "#4f8a5b"],
  ["ZOR", "#2d6a4f"],
  ["ZO", "#3d8fa8"],
];
const COR_MACROZONA_OUTRA = "#6b7280";

export function corDaMacrozona(sigla: string): string {
  const achada = CORES_MACROZONAS.find(
    ([prefixo]) => sigla === prefixo || sigla.startsWith(`${prefixo} `),
  );
  return achada?.[1] ?? COR_MACROZONA_OUTRA;
}

export const COR_EDIFICACAO = "#7a4b2a";

/** Adiciona fontes e camadas, ocultas. `antesDe` é a primeira camada de dados. */
export function adicionarCamadasImoveis(m: MapaMapLibre, antesDe?: string): void {
  m.addSource("uso-lote", {
    type: "raster",
    tiles: [URL_TILES_USO_LOTE],
    tileSize: 256,
    minzoom: 12,
    maxzoom: 19,
    attribution: ATRIBUICAO_USO_LOTE,
  });
  m.addLayer(
    {
      id: "uso-lote-wms",
      type: "raster",
      source: "uso-lote",
      minzoom: 12,
      layout: { visibility: "none" },
      paint: { "raster-opacity": 0.7, "raster-resampling": "nearest" },
    },
    antesDe,
  );

  m.addSource("macrozoneamento", {
    type: "vector",
    tiles: [urlApi("/api/v1/mapa/tiles/macrozoneamento/{z}/{x}/{y}")],
    minzoom: 0,
    maxzoom: 14,
    attribution: ATRIBUICAO_MACROZONEAMENTO,
  });
  // A sigla começa pelo tipo de zona ("ZOP 1", "ZO"): compara pelo prefixo.
  const porPrefixo: unknown[] = ["case"];
  for (const [prefixo, c] of CORES_MACROZONAS) {
    porPrefixo.push(["==", ["slice", ["get", "sigla"], 0, prefixo.length], prefixo], c);
  }
  porPrefixo.push(COR_MACROZONA_OUTRA);
  m.addLayer(
    {
      id: "macrozoneamento-preenchimento",
      type: "fill",
      source: "macrozoneamento",
      "source-layer": "macrozoneamento",
      layout: { visibility: "none" },
      paint: { "fill-color": porPrefixo as never, "fill-opacity": 0.35 },
    },
    antesDe,
  );
  m.addLayer(
    {
      id: "macrozoneamento-contorno",
      type: "line",
      source: "macrozoneamento",
      "source-layer": "macrozoneamento",
      layout: { visibility: "none" },
      paint: { "line-color": porPrefixo as never, "line-width": 1.2 },
    },
    antesDe,
  );

  m.addSource("edificacoes", {
    type: "vector",
    tiles: [urlApi("/api/v1/mapa/tiles/edificacoes/{z}/{x}/{y}")],
    minzoom: ZOOM_EDIFICACOES,
    maxzoom: 22,
    attribution: ATRIBUICAO_EDIFICACOES,
  });
  m.addLayer(
    {
      id: "edificacoes-preenchimento",
      type: "fill",
      source: "edificacoes",
      "source-layer": "edificacoes",
      minzoom: ZOOM_EDIFICACOES,
      layout: { visibility: "none" },
      paint: { "fill-color": COR_EDIFICACAO, "fill-opacity": 0.35 },
    },
    antesDe,
  );
  m.addLayer(
    {
      id: "edificacoes-contorno",
      type: "line",
      source: "edificacoes",
      "source-layer": "edificacoes",
      minzoom: ZOOM_EDIFICACOES,
      layout: { visibility: "none" },
      paint: { "line-color": COR_EDIFICACAO, "line-width": 0.8 },
    },
    antesDe,
  );
}

/** Liga ou desliga um conjunto de camadas já adicionadas. */
export function definirVisibilidade(m: MapaMapLibre, ids: string[], visivel: boolean): void {
  for (const id of ids)
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", visivel ? "visible" : "none");
}
