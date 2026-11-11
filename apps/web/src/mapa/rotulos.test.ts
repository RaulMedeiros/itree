import { describe, expect, it } from "vitest";

import { rotulosVisiveis, type RotuloMedido } from "./rotulos";

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
