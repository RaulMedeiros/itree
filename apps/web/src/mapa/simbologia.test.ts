import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aoFaltarImagem,
  camadasDoAlerta,
  COR_ALERTA,
  CORES_CONDICAO,
  iconeGrupo,
  layoutGrupo,
  registrarIcones,
  TAM_ICONE,
} from "./simbologia";

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

describe("alerta ambiental e ícones (C-12, C-28)", () => {
  it("o detalhe do alerta usa o losango do mapa principal, não a cor de condição", () => {
    const [ponto] = camadasDoAlerta("alerta", true);
    expect(ponto).toMatchObject({ type: "symbol", layout: { "icon-image": "alerta" } });
    const cores = JSON.stringify(camadasDoAlerta("alerta", false));
    expect(cores).toContain(COR_ALERTA);
    expect(cores).toContain("hachura-alerta");
    expect(cores).not.toContain(CORES_CONDICAO.ruim);
  });

  it("ícones de ocorrência, tarefa e alerta são 20% maiores e a tarefa tem contorno branco", () => {
    const larguras: number[] = [];
    const preenchimentos: string[] = [];
    const contexto = new Proxy(
      {},
      {
        get: (_, nome) => (nome === "getImageData" ? () => ({}) : () => {}),
        set: (_, nome, valor) => {
          if (nome === "fillStyle") preenchimentos.push(String(valor));
          return true;
        },
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      contexto as unknown as CanvasRenderingContext2D,
    );
    const tamanhos = new Map<string, number>();
    registrarIcones({
      hasImage: () => false,
      addImage: (nome: string, _d: unknown, o: { pixelRatio: number }) => {
        tamanhos.set(nome, o.pixelRatio);
        larguras.push(0);
      },
    } as never);
    expect(TAM_ICONE).toBe(Math.round(22 * 1.2));
    expect(tamanhos.has("tarefa-atrasada")).toBe(true);
    // Hachura das áreas verdes, uma por tipo (R3-23).
    for (const tipo of ["praca", "parque", "unidade_conservacao"])
      expect(tamanhos.has(`hachura-area-verde-${tipo}`)).toBe(true);
    expect(preenchimentos).toContain("#ffffff");
  });
});

describe("layout dos grupos (R2-07)", () => {
  it("grupos de árvores não se sobrepõem e vence o de maior quantidade", () => {
    const l = layoutGrupo("arvores");
    expect(l["icon-allow-overlap"]).toBe(false);
    expect(l["symbol-sort-key"]).toEqual(["-", ["get", "quantidade"]]);
  });

  it("grupos de ocorrências nunca são escondidos", () => {
    expect(layoutGrupo("ocorrencias")["icon-allow-overlap"]).toBe(true);
  });

  it("o ícone encolhe em zoom baixo", () => {
    const [, , , z1, t1, z2, t2] = layoutGrupo("arvores")["icon-size"] as unknown as [
      string,
      unknown,
      unknown,
      number,
      number,
      number,
      number,
    ];
    expect(z1).toBeLessThan(z2);
    expect(t1).toBeLessThan(t2);
  });
});
