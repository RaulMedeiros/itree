import { describe, expect, it } from "vitest";

import { capitalizar, faixaDeAltura, listaDeLampadas, textoDoPoste } from "./iluminacao";

describe("texto do ponto de iluminação", () => {
  it("capitaliza o texto em maiúsculas da fonte, mantendo as partículas", () => {
    expect(capitalizar("HERACLITO GRACA, AV")).toBe("Heraclito Graca, Av");
    expect(capitalizar("RUA DOS TABAJARAS")).toBe("Rua dos Tabajaras");
  });

  it("monta a faixa de altura; sem altura, não inventa", () => {
    expect(faixaDeAltura(5, 10)).toBe("5 a 10 m");
    expect(faixaDeAltura(undefined, 5)).toBe("até 5 m");
    expect(faixaDeAltura(-1, -1)).toBe("");
    expect(faixaDeAltura(null, null)).toBe("");
  });

  it("descreve o poste com o tipo e a faixa", () => {
    expect(textoDoPoste("CONCRETO DUPLO T", 5, 10)).toBe("Concreto Duplo T, 5 a 10 m");
    expect(textoDoPoste("SEM POSTE", -1, -1)).toBe("Sem Poste");
    expect(textoDoPoste("", -1, -1)).toBe("Não informado");
  });

  it("separa as lâmpadas do ponto", () => {
    expect(listaDeLampadas("LED 100 W; SODIO 400 W (2)")).toEqual(["LED 100 W", "SODIO 400 W (2)"]);
    expect(listaDeLampadas("")).toEqual([]);
    expect(listaDeLampadas(undefined)).toEqual([]);
  });
});
