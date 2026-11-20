import type { Map as MapaMapLibre } from "maplibre-gl";

import type { TipoBase } from "./estilo";
import {
  CORES_AREA_VERDE,
  COR_ALERTA,
  COR_ALERTA_SATELITE,
  OPACIDADE_AREA_VERDE,
  OPACIDADE_AREA_VERDE_UC,
} from "./simbologia";

/**
 * Pintura das camadas do iTree sobre cada mapa base. O mapa de ruas é claro e dessaturado; a
 * imagem de satélite é escura e texturizada, onde contornos verde-escuros e preenchimentos a 30%
 * somem. Sobre o satélite, os contornos viram brancos (com um halo escuro nos bairros) e os
 * preenchimentos ficam mais firmes. As cores de significado (condição, prioridade) não mudam.
 */
export const CONTORNO_BAIRRO = {
  ruas: { cor: "#2b5f45", opacidade: 0.75, larguras: [0.8, 2] },
  satelite: { cor: "#ffffff", opacidade: 0.95, larguras: [1.2, 2.8] },
} as const;

/** Halo escuro sob o contorno branco do bairro: separa a linha de praias e telhados claros. */
export const HALO_BAIRRO = { cor: "#000000", opacidade: 0.45, larguras: [3, 5.5] } as const;

export const AREA_VERDE = {
  ruas: { opacidade: OPACIDADE_AREA_VERDE, opacidadeUc: OPACIDADE_AREA_VERDE_UC },
  satelite: { opacidade: 0.5, opacidadeUc: 0.35 },
} as const;

export const CONTORNO_AREA_VERDE_SATELITE = "#ffffff";

const largura = (l: readonly [number, number], zoomFim = 15) =>
  ["interpolate", ["linear"], ["zoom"], 10, l[0], zoomFim, l[1]] as never;

/** Cor do contorno de área verde por tipo (a de cada tipo sobre ruas; branca sobre satélite). */
export const corContornoAreaVerde = (base: TipoBase, corPorTipo: unknown) =>
  (base === "satelite" ? CONTORNO_AREA_VERDE_SATELITE : corPorTipo) as never;

/** Ajusta as camadas que já existem para o mapa base escolhido. Idempotente. */
export function aplicarLegibilidade(
  m: MapaMapLibre,
  base: TipoBase,
  corPorTipoAreaVerde: unknown,
  pinturaArvores: Record<string, unknown>,
) {
  const tem = (id: string) => !!m.getLayer(id);
  const pintar = (id: string, prop: string, valor: unknown) => {
    if (tem(id)) m.setPaintProperty(id, prop as never, valor as never);
  };
  const c = CONTORNO_BAIRRO[base];
  pintar("bairros-contorno", "line-color", c.cor);
  pintar("bairros-contorno", "line-opacity", c.opacidade);
  pintar("bairros-contorno", "line-width", largura(c.larguras));
  if (tem("bairros-halo"))
    m.setLayoutProperty("bairros-halo", "visibility", base === "satelite" ? "visible" : "none");

  const av = AREA_VERDE[base];
  pintar("areas-verdes-preenchimento", "fill-opacity", [
    "match",
    ["get", "tipo"],
    "unidade_conservacao",
    av.opacidadeUc,
    av.opacidade,
  ]);
  pintar("areas-verdes-contorno", "line-color", corContornoAreaVerde(base, corPorTipoAreaVerde));
  pintar("areas-verdes-contorno", "line-opacity", base === "satelite" ? 1 : 0.9);
  pintar(
    "areas-verdes-contorno-uc",
    "line-color",
    base === "satelite" ? CONTORNO_AREA_VERDE_SATELITE : CORES_AREA_VERDE.unidade_conservacao,
  );
  pintar("alertas-borda", "line-color", base === "satelite" ? COR_ALERTA_SATELITE : COR_ALERTA);
  for (const [k, v] of Object.entries(pinturaArvores)) pintar("arvores-pontos", k, v);
}
