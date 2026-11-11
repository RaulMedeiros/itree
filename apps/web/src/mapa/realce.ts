/**
 * Realce do bairro buscado (RF-MAPA-011).
 *
 * Em vez de tingir o interior (o verde do realce apagava o verde das árvores
 * "Boa"), o exterior do bairro é esmaecido com uma máscara clara abaixo das
 * árvores, e o contorno é grosso e neutro (azul-ardósia), distinto do contorno
 * verde dos bairros comuns. O realce dura até a próxima interação do usuário
 * (clique no mapa, nova busca ou limpar).
 */
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";

export const FONTE_REALCE = "destaque";
export const FONTE_MASCARA = "destaque-mascara";
export const CAMADAS_REALCE = ["destaque-preenchimento", "destaque-contorno"];
export const COR_REALCE = "#243b53";

export interface FeicaoTerritorio {
  type: "Feature";
  id?: string | number;
  geometry: { type: string; coordinates: unknown };
  properties: { nome?: string } & Record<string, unknown>;
}

const VAZIO = { type: "FeatureCollection", features: [] } as const;

const MUNDO = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

/** Polígono do mundo com o contorno externo do bairro como buraco; `null` sem polígono. */
export function mascaraExterior(geometria: FeicaoTerritorio["geometry"]): unknown | null {
  const coordenadas = geometria.coordinates as unknown[];
  const aneis: unknown[] =
    geometria.type === "Polygon"
      ? [coordenadas[0]]
      : geometria.type === "MultiPolygon"
        ? coordenadas.map((poligono) => (poligono as unknown[])[0])
        : [];
  if (aneis.length === 0) return null;
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [MUNDO, ...aneis] },
  };
}

/**
 * Cria as fontes e camadas do realce. A máscara fica abaixo de `antesDeMascara`
 * (a primeira camada de árvores); o contorno, abaixo de `antesDe` (o anel da seleção).
 */
export function adicionarRealce(m: MapaMapLibre, antesDe?: string, antesDeMascara?: string): void {
  m.addSource(FONTE_REALCE, { type: "geojson", data: VAZIO as never });
  m.addSource(FONTE_MASCARA, { type: "geojson", data: VAZIO as never });
  m.addLayer(
    {
      id: "destaque-preenchimento",
      type: "fill",
      source: FONTE_MASCARA,
      paint: { "fill-color": "#ffffff", "fill-opacity": 0.55 },
    },
    antesDeMascara,
  );
  m.addLayer(
    {
      id: "destaque-contorno",
      type: "line",
      source: FONTE_REALCE,
      layout: { "line-join": "round" },
      paint: { "line-color": COR_REALCE, "line-width": 4.5, "line-opacity": 0.95 },
    },
    antesDe,
  );
}

/** Aplica o realce à feição ou, com `null`, remove. */
export function definirRealce(m: MapaMapLibre, feicao: FeicaoTerritorio | null): void {
  const colecao = (f: unknown) =>
    (f ? { type: "FeatureCollection", features: [f] } : VAZIO) as never;
  (m.getSource(FONTE_REALCE) as GeoJSONSource | undefined)?.setData(colecao(feicao));
  const mascara = feicao ? mascaraExterior(feicao.geometry) : null;
  (m.getSource(FONTE_MASCARA) as GeoJSONSource | undefined)?.setData(colecao(mascara));
}

/** Limites [oeste, sul, leste, norte] de uma geometria GeoJSON. */
export function limitesDaGeometria(
  geometria: FeicaoTerritorio["geometry"],
): [number, number, number, number] | null {
  let oeste = Infinity;
  let sul = Infinity;
  let leste = -Infinity;
  let norte = -Infinity;
  const percorrer = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      oeste = Math.min(oeste, c[0]);
      leste = Math.max(leste, c[0]);
      sul = Math.min(sul, c[1]);
      norte = Math.max(norte, c[1]);
      return;
    }
    for (const filho of c) percorrer(filho);
  };
  percorrer(geometria.coordinates);
  return Number.isFinite(oeste) ? [oeste, sul, leste, norte] : null;
}
