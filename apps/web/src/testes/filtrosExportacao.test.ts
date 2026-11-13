import { describe, expect, it } from "vitest";

import { filtrosParaExportar } from "../componentes/filtrosExportacao";

describe("filtrosParaExportar", () => {
  it("tira vazios, página e ordem e converte o resto em texto", () => {
    expect(
      filtrosParaExportar({
        estado: "aberta",
        bairro: "",
        pagina: 3,
        tamanho: 20,
        ordenar: "criado_em",
        ordem: "desc",
        raio: 100,
        nulo: null,
        indefinido: undefined,
        ativo: false,
      }),
    ).toEqual({ estado: "aberta", raio: "100", ativo: "false" });
  });
});
