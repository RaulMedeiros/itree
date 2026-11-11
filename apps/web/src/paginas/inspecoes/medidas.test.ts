import type { Medida } from "@itree/api-client";
import { describe, expect, it } from "vitest";

import { compararMedidas, descreverDiferenca } from "./medidas";

const medida = (tipo: Medida["tipo"], valor: string, unidade = "cm"): Medida =>
  ({ id: `${tipo}-${valor}`, tipo, valor, unidade }) as Medida;

describe("compararMedidas", () => {
  it("compara cada tipo com o cadastro e arredonda a diferença", () => {
    const [dap] = compararMedidas([medida("dap", "38.30")], [medida("dap", "32.10")]);
    expect(dap!.diferenca).toBe(6.2);
    expect(descreverDiferenca(dap!)).toBe("DAP 32,1 → 38,3 cm, +6,2");
  });

  it("mostra cada tipo uma só vez", () => {
    const comparacoes = compararMedidas(
      [medida("dap", "38"), medida("altura", "10.2", "m"), medida("dap", "36")],
      [],
    );
    expect(comparacoes.map((c) => c.proposta.valor)).toEqual(["38", "10.2"]);
  });

  it("diz o sentido da diferença, a igualdade e a falta de valor no cadastro", () => {
    const texto = (p: string, c?: string) =>
      descreverDiferenca(compararMedidas([medida("dap", p)], c ? [medida("dap", c)] : [])[0]!);
    expect(texto("38", "32")).toBe("DAP 32 → 38 cm, +6");
    expect(texto("30", "32")).toBe("DAP 32 → 30 cm, -2");
    expect(texto("32", "32")).toBe("DAP 32 cm, igual ao cadastro");
    expect(texto("38")).toBe("DAP 38 cm, sem valor no cadastro");
  });

  it("não compara tipos diferentes", () => {
    const [altura] = compararMedidas([medida("altura", "10", "m")], [medida("dap", "32")]);
    expect(altura!.cadastro).toBeUndefined();
  });
});
