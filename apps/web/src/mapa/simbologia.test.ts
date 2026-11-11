import { afterEach, describe, expect, it, vi } from "vitest";

import { aoFaltarImagem, CORES_CONDICAO, iconeGrupo } from "./simbologia";

describe("ícone de grupo", () => {
  afterEach(() => vi.restoreAllMocks());

  it("árvores: o id inclui a pior condição; ocorrências mantêm o grupo atual", () => {
    expect(iconeGrupo("arvores")).toEqual([
      "concat",
      "grupo-arvores-",
      ["coalesce", ["get", "pior_condicao"], "nao_avaliada"],
      "-",
      ["to-string", ["get", "quantidade"]],
    ]);
    expect(iconeGrupo("ocorrencias")).toEqual([
      "concat",
      "grupo-ocorrencias-",
      ["to-string", ["get", "quantidade"]],
    ]);
  });

  function desenhar(id: string) {
    const aneis: string[] = [];
    const contexto = new Proxy(
      {},
      {
        get: (_, nome) =>
          typeof nome === "string" && nome === "getImageData" ? () => ({}) : () => {},
        set: (_, nome, valor) => {
          if (nome === "strokeStyle") aneis.push(String(valor));
          return true;
        },
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      contexto as unknown as CanvasRenderingContext2D,
    );
    const addImage = vi.fn();
    aoFaltarImagem({ hasImage: () => false, addImage } as never, id);
    return { addImage, aneis };
  }

  it("desenha o anel na cor da pior condição", () => {
    const { addImage, aneis } = desenhar("grupo-arvores-morta-37");
    expect(addImage).toHaveBeenCalledWith(
      "grupo-arvores-morta-37",
      expect.anything(),
      expect.anything(),
    );
    expect(aneis).toContain(CORES_CONDICAO.morta);
  });

  it("ignora ids fora do padrão", () => {
    expect(desenhar("grupo-arvores-37").addImage).not.toHaveBeenCalled();
    expect(desenhar("grupo-ocorrencias-5").addImage).toHaveBeenCalled();
  });
});
