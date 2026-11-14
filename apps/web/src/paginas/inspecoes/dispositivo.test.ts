import { describe, expect, it } from "vitest";

import { plataformaDoDispositivo } from "./dispositivo";

describe("plataformaDoDispositivo (R3-25)", () => {
  it("reconhece a plataforma e esconde o identificador", () => {
    expect(plataformaDoDispositivo("android-sintetico")).toBe("Android");
    expect(plataformaDoDispositivo("Android-1")).toBe("Android");
    expect(plataformaDoDispositivo("iphone-14")).toBe("iOS");
  });

  it("sem reconhecer, não inventa", () => {
    expect(plataformaDoDispositivo("xyz-9")).toBeNull();
    expect(plataformaDoDispositivo("")).toBeNull();
    expect(plataformaDoDispositivo(undefined)).toBeNull();
  });
});
