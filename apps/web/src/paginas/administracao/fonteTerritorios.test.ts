import { describe, expect, it } from "vitest";

import { divergeDaFonteComum, fonteComum } from "./fonteTerritorios";

const ipplan = { fonte: "Fortaleza em Mapas (Ipplan)", fonte_url: "http://x/ipplan" };
const outra = { fonte: "Outra base", fonte_url: null };

describe("fonte comum dos territórios (R3-27)", () => {
  it("é a fonte da maioria, mostrada uma vez", () => {
    expect(fonteComum([ipplan, ipplan, outra])).toEqual(ipplan);
    expect(fonteComum([])).toBeNull();
  });

  it("na linha, só a que difere da comum aparece", () => {
    const comum = fonteComum([ipplan, ipplan, outra]);
    expect(divergeDaFonteComum(ipplan, comum)).toBe(false);
    expect(divergeDaFonteComum(outra, comum)).toBe(true);
  });
});
