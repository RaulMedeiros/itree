import { describe, expect, it } from "vitest";

import { aguardaHa, esperaEmAtencao } from "./espera";

describe("espera na fila de revisão (R3-31)", () => {
  it("chegar hoje ou há poucos dias não chama atenção", () => {
    expect(esperaEmAtencao(0)).toBe(false);
    expect(esperaEmAtencao(1)).toBe(false);
    expect(esperaEmAtencao(2)).toBe(false);
  });

  it("a partir de 3 dias o aviso ganha a cor de atenção", () => {
    expect(esperaEmAtencao(3)).toBe(true);
    expect(esperaEmAtencao(10)).toBe(true);
  });

  it("o texto diz há quantos dias", () => {
    expect(aguardaHa(0)).toBe("chegou hoje");
    expect(aguardaHa(1)).toBe("aguarda há 1 dia");
    expect(aguardaHa(3)).toBe("aguarda há 3 dias");
  });
});
