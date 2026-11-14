import { describe, expect, it } from "vitest";

import { rotuloDoBairroVisivel, rotulosVisiveis, type RotuloMedido } from "./rotulos";

const rotulo = (id: string, x: number, larguraBairro = 300): RotuloMedido => ({
  id,
  x,
  y: 100,
  largura: 120,
  altura: 14,
  larguraBairro,
});

describe("rotulosVisiveis", () => {
  it("esconde o rótulo que colide com outro, mantendo o do bairro maior", () => {
    const visiveis = rotulosVisiveis([rotulo("b", 100, 200), rotulo("c", 150, 400)]);
    expect([...visiveis]).toEqual(["c"]);
  });

  it("mantém rótulos que não se tocam", () => {
    expect(rotulosVisiveis([rotulo("b", 100), rotulo("c", 400)]).size).toBe(2);
  });

  it("esconde o rótulo mais largo que o polígono na tela", () => {
    expect(rotulosVisiveis([rotulo("b", 100, 80)]).size).toBe(0);
  });
});

describe("rotuloDoBairroVisivel (R3-20)", () => {
  it("só entre os zooms 12,5 e 14: acima, o mapa base já rotula o bairro", () => {
    expect(rotuloDoBairroVisivel(12)).toBe(false);
    expect(rotuloDoBairroVisivel(12.5)).toBe(true);
    expect(rotuloDoBairroVisivel(14)).toBe(true);
    expect(rotuloDoBairroVisivel(14.1)).toBe(false);
    expect(rotuloDoBairroVisivel(16)).toBe(false);
  });
});
