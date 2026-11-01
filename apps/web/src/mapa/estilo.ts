import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";

import type { CamadaBase } from "../config";

export type TipoBase = "ruas" | "satelite";

/** Centro padrão: Fortaleza (CE). */
export const CENTRO_PADRAO: [number, number] = [-38.5267, -3.7319];

export function estiloBase(base: CamadaBase | null): StyleSpecification {
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
      { id: "fundo", type: "background", paint: { "background-color": "#eef1ec" } },
      ...(base ? [{ id: "base", type: "raster" as const, source: "base" }] : []),
    ],
  };
}

/** Cores por origem da localização (RN-MAPA-002). Fundo vazio = importada. */
export const COR_ARVORE = "#1f6b45";

export const CORES_PRIORIDADE: Record<string, string> = {
  urgente: "#b3261e",
  alta: "#d9480f",
  media: "#c08400",
  baixa: "#1d5fa8",
  "": "#56615b",
};

export const corPorPrioridade: ExpressionSpecification = [
  "match",
  ["get", "prioridade"],
  "urgente",
  CORES_PRIORIDADE.urgente!,
  "alta",
  CORES_PRIORIDADE.alta!,
  "media",
  CORES_PRIORIDADE.media!,
  "baixa",
  CORES_PRIORIDADE.baixa!,
  CORES_PRIORIDADE[""]!,
];
