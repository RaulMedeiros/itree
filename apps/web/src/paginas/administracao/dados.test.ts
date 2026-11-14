import { describe, expect, it } from "vitest";

import { organizarTerritorios } from "./dados";

const mun = { id: "m", nome: "Fortaleza", tipo: "municipio" as const, pai: null };
const bairro = (id: string, nome: string) => ({
  id,
  nome,
  tipo: "bairro" as const,
  pai: { id: "m" },
});

describe("organizarTerritorios (R3-28)", () => {
  it("sem nada marcado, lista o município e os bairros por nome", () => {
    const lista = organizarTerritorios(
      [bairro("b2", "Meireles"), mun, bairro("b1", "Aldeota")],
      [],
    );
    expect(lista.map((o) => o.rotulo)).toEqual(["Fortaleza", "Aldeota", "Meireles"]);
    expect(lista.every((o) => o.nota === undefined)).toBe(true);
  });

  it("com o município marcado, os bairros saem e o município leva uma nota única", () => {
    const lista = organizarTerritorios(
      [mun, bairro("b1", "Aldeota"), bairro("b2", "Meireles")],
      ["m"],
    );
    expect(lista.map((o) => o.rotulo)).toEqual(["Fortaleza"]);
    expect(lista[0]!.nota).toBe("Cobre também os 2 territórios abaixo dele");
  });

  it("um único território abaixo usa o singular", () => {
    const lista = organizarTerritorios([mun, bairro("b1", "Aldeota")], ["m"]);
    expect(lista[0]!.nota).toBe("Cobre também o território abaixo dele");
  });

  it("marcar só um bairro não esconde os irmãos", () => {
    const lista = organizarTerritorios(
      [mun, bairro("b1", "Aldeota"), bairro("b2", "Meireles")],
      ["b1"],
    );
    expect(lista.map((o) => o.rotulo)).toEqual(["Fortaleza", "Aldeota", "Meireles"]);
  });
});
