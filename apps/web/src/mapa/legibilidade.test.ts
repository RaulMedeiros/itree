import { describe, expect, it, vi } from "vitest";

import { estiloBase } from "./estilo";
import { aplicarLegibilidade, CONTORNO_BAIRRO } from "./legibilidade";
import { COR_ALERTA, COR_ALERTA_SATELITE, CORES_AREA_VERDE, pinturaArvores } from "./simbologia";

/** Mapa mínimo: guarda a última pintura aplicada a cada propriedade das camadas existentes. */
function mapaCom(camadas: string[]) {
  const pintura = new Map<string, unknown>();
  const visibilidade = new Map<string, unknown>();
  return {
    pintura,
    visibilidade,
    m: {
      getLayer: (id: string) => (camadas.includes(id) ? { id } : undefined),
      setPaintProperty: vi.fn((id: string, prop: string, v: unknown) =>
        pintura.set(`${id}:${prop}`, v),
      ),
      setLayoutProperty: vi.fn((id: string, prop: string, v: unknown) =>
        visibilidade.set(`${id}:${prop}`, v),
      ),
    } as never,
  };
}

const TODAS = [
  "bairros-contorno",
  "bairros-halo",
  "areas-verdes-preenchimento",
  "areas-verdes-contorno",
  "areas-verdes-contorno-uc",
  "alertas-borda",
  "arvores-pontos",
];
const POR_TIPO = ["match", ["get", "tipo"], "praca", "#1b6b3a", "#555555"];

describe("legibilidade sobre o satélite", () => {
  it("troca os contornos verde-escuros por brancos e liga o halo dos bairros", () => {
    const { m, pintura, visibilidade } = mapaCom(TODAS);
    aplicarLegibilidade(m, "satelite", POR_TIPO, pinturaArvores("condicao", "satelite"));
    expect(pintura.get("bairros-contorno:line-color")).toBe("#ffffff");
    expect(visibilidade.get("bairros-halo:visibility")).toBe("visible");
    expect(pintura.get("areas-verdes-contorno:line-color")).toBe("#ffffff");
    expect(pintura.get("areas-verdes-contorno-uc:line-color")).toBe("#ffffff");
    expect(pintura.get("alertas-borda:line-color")).toBe(COR_ALERTA_SATELITE);
    // Preenchimento das áreas verdes mais firme que os 30% do mapa de ruas.
    expect(JSON.stringify(pintura.get("areas-verdes-preenchimento:fill-opacity"))).toContain("0.5");
  });

  it("restaura a pintura do mapa de ruas ao voltar", () => {
    const { m, pintura, visibilidade } = mapaCom(TODAS);
    aplicarLegibilidade(m, "satelite", POR_TIPO, pinturaArvores("condicao", "satelite"));
    aplicarLegibilidade(m, "ruas", POR_TIPO, pinturaArvores("condicao", "ruas"));
    expect(pintura.get("bairros-contorno:line-color")).toBe(CONTORNO_BAIRRO.ruas.cor);
    expect(visibilidade.get("bairros-halo:visibility")).toBe("none");
    expect(pintura.get("areas-verdes-contorno:line-color")).toBe(POR_TIPO);
    expect(pintura.get("areas-verdes-contorno-uc:line-color")).toBe(
      CORES_AREA_VERDE.unidade_conservacao,
    );
    expect(pintura.get("alertas-borda:line-color")).toBe(COR_ALERTA);
    expect(pintura.get("arvores-pontos:circle-stroke-color")).toEqual(
      pinturaArvores("condicao", "ruas")["circle-stroke-color"],
    );
  });

  it("não falha com camadas que o usuário não tem (sem permissão)", () => {
    const { m } = mapaCom(["bairros-contorno"]);
    expect(() =>
      aplicarLegibilidade(m, "satelite", POR_TIPO, pinturaArvores("condicao", "satelite")),
    ).not.toThrow();
  });

  it("árvores: contorno branco em todas as origens sobre o satélite, GPS mais grosso", () => {
    const p = pinturaArvores("condicao", "satelite");
    expect(p["circle-stroke-color"]).toBe("#ffffff");
    expect(JSON.stringify(p["circle-stroke-width"])).toContain("3");
    // Sobre as ruas continua o anel verde-escuro do GPS, que o branco no satélite substitui.
    expect(JSON.stringify(pinturaArvores("condicao", "ruas")["circle-stroke-color"])).toContain(
      "#0b3d2a",
    );
    // A cor de significado (condição) não muda com o fundo.
    expect(p["circle-color"]).toEqual(pinturaArvores("condicao", "ruas")["circle-color"]);
  });

  it("contorno do bairro branco a ≥ 4,5:1 de um fundo de satélite escuro típico (#2c3a2a)", () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const razao = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    };
    expect(razao(CONTORNO_BAIRRO.satelite.cor, "#2c3a2a")).toBeGreaterThan(4.5);
    // O contorno verde-escuro do mapa de ruas não passa de 3:1 nesse fundo: o motivo da troca.
    expect(razao(CONTORNO_BAIRRO.ruas.cor, "#2c3a2a")).toBeLessThan(3);
  });
});

describe("zoom nativo do satélite", () => {
  it("limita o zoom da fonte ao do provedor, para o mapa sobreamostrar além dele", () => {
    const estilo = estiloBase(
      { url: "https://t/{z}/{y}/{x}.jpg", atribuicao: "x", zoomMaximo: 14 },
      "satelite",
    );
    expect(estilo.sources.base).toMatchObject({ type: "raster", maxzoom: 14 });
  });

  it("sem zoom informado, mantém o padrão", () => {
    const estilo = estiloBase({ url: "https://t/{z}/{x}/{y}.png", atribuicao: "x" }, "ruas");
    expect(estilo.sources.base).toMatchObject({ maxzoom: 19 });
  });
});
