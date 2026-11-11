import { describe, expect, it } from "vitest";

import { poligonoDeCantos, poligonoDeVertices } from "./desenho";
import { arredondarArea, codificarArea, decodificarArea } from "./areaUrl";

describe("área na URL", () => {
  it("vai e volta com 6 casas, sem o vértice de fechamento no texto", () => {
    const area = poligonoDeCantos([-38.560001, -3.76], [-38.55, -3.7500004]);
    const texto = codificarArea(area);
    expect(texto).toMatch(/^[-0-9a-z_]+$/);
    expect(texto.split("_")).toHaveLength(8);
    expect(decodificarArea(texto)).toEqual(arredondarArea(area));
    expect(decodificarArea(texto)!.coordinates[0]![0]).toEqual([-38.560001, -3.76]);
  });

  it("é compacta: um retângulo cabe em menos de 40 caracteres", () => {
    const texto = codificarArea(poligonoDeCantos([-38.543211, -3.731234], [-38.52, -3.71]));
    expect(texto.length).toBeLessThan(40);
  });

  it("guarda polígonos com muitos vértices", () => {
    const area = poligonoDeVertices([
      [-38.5, -3.7],
      [-38.49, -3.7],
      [-38.48, -3.71],
      [-38.49, -3.72],
      [-38.51, -3.71],
    ])!;
    expect(decodificarArea(codificarArea(area))).toEqual(area);
  });

  it("texto inválido ou fora do mundo vira nulo, sem lançar erro", () => {
    for (const ruim of [
      undefined,
      "",
      "abc",
      "1_2_3",
      "1_2_3_4",
      "x!_1_2_3_4_5",
      "zzzzzzzz_0_1_1_2_2",
    ])
      expect(decodificarArea(ruim)).toBeNull();
    expect(decodificarArea("0_0_0_0_0_0")).not.toBeNull();
  });
});
