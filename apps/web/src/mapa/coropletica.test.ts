import { describe, expect, it } from "vitest";

import {
  CORES_ARBORIZACAO,
  COR_POR_VALOR,
  QUEBRAS_ARBORIZACAO,
  ROTULOS_CLASSES_ARBORIZACAO,
  classeArborizacao,
  classePorQuebras,
  coresDasClasses,
  corPorQuebras,
  CORES_POPULACAO,
  formatarIndicadorPopulacao,
  rotulosDasClasses,
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

describe("classes por quantis (população e renda)", () => {
  const quebras = [5688, 8722, 11023, 14008];

  it("o limite inferior de cada classe é inclusivo e sem dado não é zero", () => {
    expect(
      [0, 5687.9, 5688, 8722, 14007, 14008, 99999].map((v) => classePorQuebras(v, quebras)),
    ).toEqual([0, 0, 1, 2, 3, 4, 4]);
    expect(classePorQuebras(null, quebras)).toBeNull();
    expect(classePorQuebras(undefined, quebras)).toBeNull();
  });

  it("a expressão do mapa repete as quebras da API e usa a propriedade escolhida", () => {
    expect(corPorQuebras("renda", quebras)).toEqual([
      "step",
      ["get", "renda"],
      CORES_POPULACAO[0],
      5688,
      CORES_POPULACAO[1],
      8722,
      CORES_POPULACAO[2],
      11023,
      CORES_POPULACAO[3],
      14008,
      CORES_POPULACAO[4],
    ]);
  });

  it("com classes fundidas (valores repetidos) usa menos cores, mantendo as pontas", () => {
    expect(coresDasClasses(3)).toEqual([
      CORES_POPULACAO[0],
      CORES_POPULACAO[2],
      CORES_POPULACAO[4],
    ]);
    expect(corPorQuebras("idh", [0.3, 0.5])).toHaveLength(7);
  });

  it("os rótulos vão de 'Menos de' a 'ou mais', com a unidade", () => {
    const f = (v: number) => formatarIndicadorPopulacao("renda", v);
    expect(rotulosDasClasses([2000, 3000], f)).toEqual([
      "Menos de R$ 2.000",
      "R$ 2.000 a menos de R$ 3.000",
      "R$ 3.000 ou mais",
    ]);
    expect(rotulosDasClasses([], f)).toEqual([]);
  });

  it("formata cada indicador como a pessoa lê", () => {
    expect(formatarIndicadorPopulacao("densidade", 10987.01)).toBe("10.987 hab/km²");
    expect(formatarIndicadorPopulacao("idh", 0.8666)).toBe("0,867");
    expect(formatarIndicadorPopulacao("arvores_por_mil", 0.094)).toBe("0,09 por 1.000 hab.");
  });
});
