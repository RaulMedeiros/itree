/**
 * Camada "Ilha de calor (UrbVerde)": WMS do GeoServer da UrbVerde (IAU-USP) como fonte raster do
 * MapLibre. Mesma camada e mesmo pedido que o site da UrbVerde usa para "Ilhas de calor urbano de
 * superfície" (``raster_temperatura_icus_nacional_2025``). É contexto, desligada por padrão: o
 * navegador só pede tiles depois que a pessoa a liga, e nada é gravado.
 *
 * Cada pixel de 30 m é a diferença, em °C, entre a temperatura de superfície e a mediana do
 * município no ano (Landsat 8 e 9). Não é temperatura do ar, e só se compara dentro do município.
 * Termos de uso da UrbVerde: uso público e acadêmico, sem fins comerciais, citando a fonte.
 */
import type { Map as MapaMapLibre } from "maplibre-gl";

export const FONTE_ILHA_CALOR = "ilha-calor";
export const CAMADA_ILHA_CALOR = "ilha-calor-wms";
export const ZOOM_MAXIMO_ILHA_CALOR = 18;
export const OPACIDADE_ILHA_CALOR = 0.65;

const GEOSERVER = "https://urbverde.iau.usp.br/geoserver/urbverde";
const CAMADA_WMS = "urbverde:raster_temperatura_icus_nacional_2025";

/** Modelo de URL dos tiles: o MapLibre troca `{bbox-epsg-3857}` pelo retângulo de cada tile. */
export const URL_TILES_ILHA_CALOR =
  `${GEOSERVER}/wms?service=WMS&version=1.1.0&request=GetMap&layers=${CAMADA_WMS}` +
  "&bbox={bbox-epsg-3857}&width=256&height=256&srs=EPSG:3857&format=image/png&transparent=true";

/** Legenda oficial da camada (GetLegendGraphic): -5 °C ou menos, 0 °C, +5 °C ou mais. */
export const URL_LEGENDA_ILHA_CALOR =
  `${GEOSERVER}/ows?service=WMS&version=1.3.0&request=GetLegendGraphic&format=image%2Fpng` +
  "&width=20&height=20&layer=raster_temperatura_icus_nacional_2025";

/** Atribuição exigida pelos termos de uso (aparece no canto do mapa e na legenda). */
export const ATRIBUICAO_ILHA_CALOR =
  "Plataforma UrbVerde – USP (IAU-USP): ilhas de calor urbano de superfície, 2025";

export const DEFINICAO_ILHA_CALOR =
  "Diferença entre a temperatura de superfície e a mediana de Fortaleza em 2025, em pixels de " +
  "30 m. Não é temperatura do ar nem prova de irregularidade.";

/**
 * Adiciona a fonte e a camada, ocultas. `antesDe` é a primeira camada de dados: o raster fica
 * entre o mapa base e todo o resto.
 */
export function adicionarIlhaCalor(m: MapaMapLibre, antesDe?: string): void {
  m.addSource(FONTE_ILHA_CALOR, {
    type: "raster",
    tiles: [URL_TILES_ILHA_CALOR],
    tileSize: 256,
    maxzoom: ZOOM_MAXIMO_ILHA_CALOR,
    attribution: ATRIBUICAO_ILHA_CALOR,
  });
  m.addLayer(
    {
      id: CAMADA_ILHA_CALOR,
      type: "raster",
      source: FONTE_ILHA_CALOR,
      layout: { visibility: "none" },
      // O pedido do site da UrbVerde também usa "nearest": o pixel de 30 m não é suavizado.
      paint: { "raster-opacity": OPACIDADE_ILHA_CALOR, "raster-resampling": "nearest" },
    },
    antesDe,
  );
}
