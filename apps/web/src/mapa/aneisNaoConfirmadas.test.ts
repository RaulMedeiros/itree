import { describe, expect, it, vi } from "vitest";

import {
  CAMADAS_ANEL_NAO_CONFIRMADA,
  COR_NAO_CONFIRMADA,
  adicionarAneisNaoConfirmadas,
  filtroArvoreIndividual,
  filtroNaoConfirmada,
} from "./simbologia";

describe("anel da árvore detectada e não confirmada", () => {
  it("adiciona halo e anel só para confirmada = falso, sem preencher o ponto", () => {
    const camadas: { id: string; filter: unknown; paint: Record<string, unknown> }[] = [];
    const m = { addLayer: vi.fn((c) => camadas.push(c)) };
    adicionarAneisNaoConfirmadas(m as never, filtroArvoreIndividual);
    expect(camadas.map((c) => c.id)).toEqual([...CAMADAS_ANEL_NAO_CONFIRMADA]);
    for (const c of camadas) {
      expect(c.filter).toEqual(["all", filtroArvoreIndividual, filtroNaoConfirmada]);
      expect(c.paint["circle-opacity"]).toBe(0);
    }
    expect(camadas[1]!.paint["circle-stroke-color"]).toBe(COR_NAO_CONFIRMADA);
    expect(filtroNaoConfirmada).toEqual(["==", ["get", "confirmada"], false]);
  });
});
