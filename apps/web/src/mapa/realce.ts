/**
 * Realce do bairro buscado (RF-MAPA-011).
 *
 * O polígono ganha preenchimento translúcido e contorno forte na cor da marca,
 * acima das árvores mas com opacidade baixa, para não escondê-las. O realce
 * dura até a próxima interação do usuário (clique no mapa, nova busca ou
 * limpar).
 */
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";

import { COR_ARVORE } from "./simbologia";

export const FONTE_REALCE = "destaque";
export const CAMADAS_REALCE = ["destaque-preenchimento", "destaque-contorno"];

export interface FeicaoTerritorio {
  type: "Feature";
  id?: string | number;
  geometry: { type: string; coordinates: unknown };
  properties: { nome?: string } & Record<string, unknown>;
}

const VAZIO = { type: "FeatureCollection", features: [] } as const;

/** Cria a fonte e as camadas do realce; ficam abaixo de `antesDe` (o anel da seleção). */
export function adicionarRealce(m: MapaMapLibre, antesDe?: string): void {
  m.addSource(FONTE_REALCE, { type: "geojson", data: VAZIO as never });
  m.addLayer(
    {
      id: "destaque-preenchimento",
      type: "fill",
      source: FONTE_REALCE,
      paint: { "fill-color": COR_ARVORE, "fill-opacity": 0.16 },
    },
    antesDe,
  );
  m.addLayer(
    {
      id: "destaque-contorno",
      type: "line",
      source: FONTE_REALCE,
      layout: { "line-join": "round" },
      paint: { "line-color": COR_ARVORE, "line-width": 3.5, "line-opacity": 0.95 },
    },
    antesDe,
  );
}

/** Aplica o realce à feição ou, com `null`, remove. */
export function definirRealce(m: MapaMapLibre, feicao: FeicaoTerritorio | null): void {
  (m.getSource(FONTE_REALCE) as GeoJSONSource | undefined)?.setData(
    (feicao ? { type: "FeatureCollection", features: [feicao] } : VAZIO) as never,
  );
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
