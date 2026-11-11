import { describe, expect, it } from "vitest";

import { descreverPrazo } from "./formatos";

describe("descreverPrazo", () => {
  const hoje = new Date("2026-11-11T15:00:00Z");
  it("conta os dias restantes e o atraso", () => {
    expect(descreverPrazo("2026-11-30", hoje)).toBe("faltam 19 dias");
    expect(descreverPrazo("2026-11-12", hoje)).toBe("falta 1 dia");
    expect(descreverPrazo("2026-11-11", hoje)).toBe("vence hoje");
    expect(descreverPrazo("2026-11-08", hoje)).toBe("atrasado há 3 dias");
  });
});
