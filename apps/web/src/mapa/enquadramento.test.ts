import { describe, expect, it } from "vitest";

import { LARGURA_PAINEL_CAMADAS_PX, limitesDosPontos, paddingDoMapa } from "./enquadramento";

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

describe("paddingDoMapa (R3-21)", () => {
  it("com o painel de camadas aberto, reserva a largura dele à esquerda", () => {
    expect(paddingDoMapa(true).left).toBe(LARGURA_PAINEL_CAMADAS_PX + 40);
    expect(paddingDoMapa(true).right).toBe(40);
  });

  it("com o painel fechado, a folga é a mesma nos quatro lados", () => {
    expect(paddingDoMapa(false)).toEqual({ top: 40, right: 40, bottom: 40, left: 40 });
  });
});
