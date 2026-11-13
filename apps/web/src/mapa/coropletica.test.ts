import { describe, expect, it } from "vitest";

import {
  CORES_ARBORIZACAO,
  COR_POR_VALOR,
  QUEBRAS_ARBORIZACAO,
  ROTULOS_CLASSES_ARBORIZACAO,
  classeArborizacao,
} from "./coropletica";

describe("classes da arborização do entorno", () => {
  it("usa quebras fixas, com o limite inferior em cada classe", () => {
    expect(QUEBRAS_ARBORIZACAO).toEqual([40, 50, 60, 70]);
    const classes = [0, 39.99, 40, 49.99, 50, 59.99, 60, 69.99, 70, 100].map(classeArborizacao);
    expect(classes).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("sem dado não é zero: devolve nulo", () => {
    expect(classeArborizacao(null)).toBeNull();
    expect(classeArborizacao(undefined)).toBeNull();
    expect(classeArborizacao(Number.NaN)).toBeNull();
  });

  it("tem cinco classes, cada uma com cor e rótulo, e a expressão do mapa repete as quebras", () => {
    expect(CORES_ARBORIZACAO).toHaveLength(5);
    expect(new Set(CORES_ARBORIZACAO).size).toBe(5);
    expect(ROTULOS_CLASSES_ARBORIZACAO).toHaveLength(5);
    expect(COR_POR_VALOR).toEqual([
      "step",
      ["get", "valor"],
      CORES_ARBORIZACAO[0],
      40,
      CORES_ARBORIZACAO[1],
      50,
      CORES_ARBORIZACAO[2],
      60,
      CORES_ARBORIZACAO[3],
      70,
      CORES_ARBORIZACAO[4],
    ]);
  });
});
