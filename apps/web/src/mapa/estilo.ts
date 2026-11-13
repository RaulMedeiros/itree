import type { StyleSpecification } from "maplibre-gl";

import type { CamadaBase } from "../config";

export type TipoBase = "ruas" | "satelite";

/** Centro padrão: Fortaleza (CE). */
export const CENTRO_PADRAO: [number, number] = [-38.5267, -3.7319];

/**
 * Mapa de ruas discreto: o OpenStreetMap padrão é muito colorido (vias
 * amarelas, áreas rosa, ícones) e compete com os dados. Dessaturar e clarear
 * mantém a referência urbana e deixa a cor para as camadas da plataforma.
 * Rótulos, ícones de comércio e números de porta do OSM ficam num cinza claro
 * (brilho mínimo alto): legíveis de perto, mas abaixo dos dados da plataforma (R3-20).
 * A imagem de satélite não é alterada. Os valores são conferidos por
 * `packages/ui-tokens/scripts/contraste.mjs`.
 */
export function pinturaBase(tipo: TipoBase) {
  return tipo === "ruas"
    ? {
        "raster-saturation": -0.9,
        "raster-contrast": -0.2,
        "raster-brightness-min": 0.28,
        "raster-brightness-max": 1,
      }
    : {};
}

export function estiloBase(base: CamadaBase | null, tipo: TipoBase = "ruas"): StyleSpecification {
  return {
    version: 8,
    sources: base
      ? {
          base: {
            type: "raster",
            tiles: [base.url],
            tileSize: base.tamanho ?? 256,
            attribution: base.atribuicao,
            maxzoom: 19,
          },
        }
      : {},
    layers: [
      { id: "fundo", type: "background", paint: { "background-color": "#f1f3ef" } },
      ...(base
        ? [{ id: "base", type: "raster" as const, source: "base", paint: pinturaBase(tipo) }]
        : []),
    ],
  };
}
