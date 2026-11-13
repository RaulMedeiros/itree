import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { pinturaBase } from "./estilo";
import { CORES_AREA_VERDE, OPACIDADE_AREA_VERDE } from "./simbologia";

describe("mapa base discreto (R3-20)", () => {
  it("dessatura e clareia o OSM o bastante para os rótulos e ícones dele ficarem em segundo plano", () => {
    const p = pinturaBase("ruas");
    expect(p["raster-saturation"]).toBeLessThanOrEqual(-0.88);
    expect(p["raster-brightness-min"]).toBeGreaterThanOrEqual(0.25);
    expect(p["raster-contrast"]).toBeLessThanOrEqual(-0.15);
  });

  it("não altera a imagem de satélite", () => {
    expect(pinturaBase("satelite")).toEqual({});
  });
});

const estilos = readFileSync(join(process.cwd(), "src/estilos.css"), "utf8");

describe("rótulo de bairro (R3-22)", () => {
  it("tem halo branco sólido por trás do texto, para ler sobre classes escuras", () => {
    const regra = estilos.match(/\.rotulo-bairro\s*\{[^}]*\}/)?.[0] ?? "";
    expect(regra).toMatch(/-webkit-text-stroke:\s*3px var\(--color-superficie\)/);
    expect(regra).toMatch(/paint-order:\s*stroke fill/);
  });
});

describe("áreas verdes (R3-23)", () => {
  it("têm preenchimento mais firme que antes e cores escuras para o contorno", () => {
    expect(OPACIDADE_AREA_VERDE).toBeGreaterThanOrEqual(0.3);
    // Contorno na cor do tipo a 90%: cores escuras (luminância baixa) leem-se sobre o mapa claro.
    for (const cor of Object.values(CORES_AREA_VERDE)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16));
      expect(0.299 * r! + 0.587 * g! + 0.114 * b!).toBeLessThan(115);
    }
  });
});
