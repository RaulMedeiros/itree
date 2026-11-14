import type { ArvoreProxima } from "@itree/api-client";

import { limitesDosPontos, type Caixa } from "../../mapa/enquadramento";

const METROS_POR_GRAU = 111_320;

/** Polígono aproximado (64 lados) do círculo de `raioM` metros em volta de `[lon, lat]`. */
export function circuloGeoJson(lon: number, lat: number, raioM: number, lados = 64) {
  const dLat = raioM / METROS_POR_GRAU;
  const dLon = raioM / (METROS_POR_GRAU * Math.cos((lat * Math.PI) / 180));
  const anel: [number, number][] = [];
  for (let i = 0; i <= lados; i++) {
    const t = (2 * Math.PI * (i % lados)) / lados;
    anel.push([lon + dLon * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Polygon" as const, coordinates: [anel] },
      },
    ],
  };
}

/** Árvores próximas como pontos, com as propriedades que a pintura por condição lê. */
export function arvoresProximasGeoJson(arvores: ArvoreProxima[]) {
  return {
    type: "FeatureCollection" as const,
    features: arvores.map((a) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [a.longitude, a.latitude] },
      properties: {
        id: a.id,
        codigo: a.codigo,
        condicao: a.condicao_aparente || "nao_avaliada",
        localizacao_origem: "",
      },
    })),
  };
}

/**
 * O que o mini-mapa do alerta desenha (R3-24). O círculo do raio só existe para alerta em ponto:
 * em polígono a distância é medida até a borda, e um círculo em volta do centro mentiria.
 * O enquadramento cobre o raio (quando há círculo) e as árvores listadas.
 */
export function dadosDoMapaDoAlerta(
  geometria: { type: string; coordinates: unknown },
  arvores: ArvoreProxima[],
  raioM: number,
): {
  raio: ReturnType<typeof circuloGeoJson> | null;
  arvores: ReturnType<typeof arvoresProximasGeoJson>;
  caixa: Caixa | null;
} {
  const pontos: [number, number][] = arvores.map((a) => [a.longitude, a.latitude]);
  let raio: ReturnType<typeof circuloGeoJson> | null = null;
  if (geometria.type === "Point") {
    const [lon, lat] = geometria.coordinates as [number, number];
    raio = circuloGeoJson(lon, lat, raioM);
    for (const [x, y] of raio.features[0]!.geometry.coordinates[0]!) pontos.push([x, y]);
  }
  return { raio, arvores: arvoresProximasGeoJson(arvores), caixa: limitesDosPontos(pontos) };
}
