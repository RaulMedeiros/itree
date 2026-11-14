import type { ArvoreProxima } from "@itree/api-client";
import { describe, expect, it } from "vitest";

import { circuloGeoJson, dadosDoMapaDoAlerta } from "./mapaAlerta";

const arvore = (extra: Partial<ArvoreProxima>): ArvoreProxima => ({
  id: "a-1",
  codigo: "ARV-000001",
  especie: null,
  condicao_aparente: "boa",
  distancia_m: 79,
  latitude: -3.7,
  longitude: -38.5,
  ...extra,
});

describe("circuloGeoJson (R3-24)", () => {
  it("fecha o anel e fica a `raio` metros do centro", () => {
    const anel = circuloGeoJson(-38.5, -3.7, 100).features[0]!.geometry.coordinates[0]!;
    expect(anel[0]).toEqual(anel[anel.length - 1]);
    const leste = anel[0]!; // ângulo 0: mesmo paralelo, a leste
    const metros = (leste[0] - -38.5) * 111_320 * Math.cos((-3.7 * Math.PI) / 180);
    expect(metros).toBeCloseTo(100, 0);
    expect(leste[1]).toBeCloseTo(-3.7, 6);
  });
});

describe("dadosDoMapaDoAlerta (R3-24)", () => {
  const ponto = { type: "Point", coordinates: [-38.5, -3.7] };

  it("alerta em ponto: desenha o raio e as árvores, e enquadra os dois", () => {
    const dados = dadosDoMapaDoAlerta(
      ponto,
      [arvore({ longitude: -38.4995, latitude: -3.7002 })],
      100,
    );
    expect(dados.raio).not.toBeNull();
    expect(dados.arvores.features).toHaveLength(1);
    expect(dados.arvores.features[0]!.properties.condicao).toBe("boa");
    // A caixa cobre o círculo de 100 m (≈ 0,0009°), não só a árvore.
    const [oeste, , leste] = dados.caixa!;
    expect(oeste).toBeLessThan(-38.5008);
    expect(leste).toBeGreaterThan(-38.4992);
  });

  it("alerta em polígono: sem círculo, porque a distância é até a borda", () => {
    const poligono = { type: "Polygon", coordinates: [[[-38.5, -3.7]]] };
    const dados = dadosDoMapaDoAlerta(poligono, [arvore({})], 100);
    expect(dados.raio).toBeNull();
    expect(dados.arvores.features).toHaveLength(1);
  });

  it("árvore sem condição vira não avaliada, como no mapa principal", () => {
    const dados = dadosDoMapaDoAlerta(ponto, [arvore({ condicao_aparente: "" })], 100);
    expect(dados.arvores.features[0]!.properties.condicao).toBe("nao_avaliada");
  });
});
