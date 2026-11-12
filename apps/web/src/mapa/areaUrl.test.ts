import { describe, expect, it } from "vitest";

import { poligonoDeCantos, poligonoDeVertices } from "./desenho";
import {
  MAX_VERTICES,
  TOLERANCIA_INICIAL_M,
  arredondarArea,
  codificarArea,
  decodificarArea,
  simplificarArea,
} from "./areaUrl";

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

/** Círculo de `n` vértices, de raio `raioM` metros, perto de Fortaleza. */
function circulo(n: number, raioM: number) {
  const lat0 = -3.73;
  const vertices = Array.from({ length: n }, (_, i) => {
    const ang = (2 * Math.PI * i) / n;
    return [
      -38.52 + (raioM * Math.cos(ang)) / (111_320 * Math.cos((lat0 * Math.PI) / 180)),
      lat0 + (raioM * Math.sin(ang)) / 110_574,
    ] as [number, number];
  });
  return poligonoDeVertices(vertices)!;
}

describe("simplificação de polígonos grandes (M-19)", () => {
  it("até 200 vértices a área passa intacta, sem tolerância", () => {
    const area = circulo(MAX_VERTICES, 300);
    const r = simplificarArea(area);
    expect(r.area).toBe(area);
    expect(r).toMatchObject({ verticesAntes: 200, verticesDepois: 200, toleranciaM: null });
  });

  it("acima de 200 vértices, o texto da URL antes não decodificava e agora cabe", () => {
    const area = circulo(800, 300);
    expect(decodificarArea(codificarArea(area))).toBeNull();
    const r = simplificarArea(area);
    expect(r.verticesAntes).toBe(800);
    expect(r.verticesDepois).toBeLessThanOrEqual(MAX_VERTICES);
    expect(r.toleranciaM).toBeGreaterThanOrEqual(TOLERANCIA_INICIAL_M);
    expect(decodificarArea(codificarArea(r.area))).not.toBeNull();
  });

  it("só mantém vértices originais e o anel continua fechado", () => {
    const area = circulo(500, 400);
    const original = new Set(area.coordinates[0]!.map((p) => p.join(",")));
    const anel = simplificarArea(area).area.coordinates[0]!;
    expect(anel[0]).toEqual(anel.at(-1));
    for (const p of anel) expect(original.has(p.join(","))).toBe(true);
  });

  it("a forma não se afasta mais que a tolerância usada", () => {
    const area = circulo(600, 500);
    const r = simplificarArea(area);
    const anel = r.area.coordinates[0]!;
    const kLon = 111_320 * Math.cos((-3.73 * Math.PI) / 180);
    const plano = (p: [number, number]) => [p[0] * kLon, p[1] * 110_574] as const;
    const aoSegmento = (
      p: readonly [number, number],
      a: readonly [number, number],
      b: readonly [number, number],
    ) => {
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
      );
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    for (const original of area.coordinates[0]!.slice(0, -1)) {
      const d = Math.min(
        ...anel
          .slice(0, -1)
          .map((a, i) => aoSegmento(plano(original), plano(a), plano(anel[i + 1]!))),
      );
      expect(d).toBeLessThanOrEqual(r.toleranciaM! + 1e-6);
    }
  });

  it("um contorno com muitos pontos quase alinhados cai para os cantos, com 1 m", () => {
    // Retângulo de 1 km com 100 pontos por lado, ruído de ~0,2 m.
    const vertices: [number, number][] = [];
    const lado = (de: [number, number], ate: [number, number]) => {
      for (let i = 0; i < 100; i++)
        vertices.push([
          de[0] + ((ate[0] - de[0]) * i) / 100 + (i % 2) * 2e-6,
          de[1] + ((ate[1] - de[1]) * i) / 100,
        ]);
    };
    const a: [number, number] = [-38.53, -3.74];
    const b: [number, number] = [-38.52, -3.74];
    const c: [number, number] = [-38.52, -3.73];
    const d: [number, number] = [-38.53, -3.73];
    lado(a, b);
    lado(b, c);
    lado(c, d);
    lado(d, a);
    const r = simplificarArea(poligonoDeVertices(vertices)!);
    expect(r.verticesAntes).toBe(400);
    expect(r.verticesDepois).toBeLessThanOrEqual(12);
    expect(r.toleranciaM).toBe(TOLERANCIA_INICIAL_M);
  });
});
