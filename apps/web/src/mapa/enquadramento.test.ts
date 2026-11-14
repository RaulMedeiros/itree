import { describe, expect, it } from "vitest";

import { limitesDosPontos } from "./enquadramento";

describe("limitesDosPontos (R3-16)", () => {
  it("devolve a caixa que contém todos os pontos", () => {
    expect(
      limitesDosPontos([
        [-38.55, -3.78],
        [-38.48, -3.72],
        [-38.52, -3.75],
      ]),
    ).toEqual([-38.55, -3.78, -38.48, -3.72]);
  });

  it("sem pontos não há enquadramento", () => {
    expect(limitesDosPontos([])).toBeNull();
    expect(limitesDosPontos([[Number.NaN, 1]])).toBeNull();
  });

  it("um ponto só ganha uma folga, para o mapa não ampliar até o zoom máximo", () => {
    const [oeste, sul, leste, norte] = limitesDosPontos([[-38.5, -3.7]])!;
    expect(leste - oeste).toBeGreaterThan(0);
    expect(norte - sul).toBeGreaterThan(0);
  });
});
