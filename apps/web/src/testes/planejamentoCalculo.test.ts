import { describe, expect, it } from "vitest";

import {
  CENARIOS,
  buscaDosPesos,
  cenarioAtivo,
  classesDePrioridade,
  criteriosAtivos,
  csvDoCenario,
  formatarValor,
  ordenar,
  pesosDaBusca,
  pontuar,
  type Pesos,
} from "../paginas/planejamento/calculo";
import { bairrosDeTeste, criteriosDeTeste } from "./planejamentoDados";

const igual = pesosDaBusca({});
const bairros = bairrosDeTeste();
const semCalor = criteriosDeTeste(false);
const comCalor = criteriosDeTeste(true);
const zerar = (extra: Partial<Pesos>): Pesos => ({
  arborizacao: 0,
  densidade: 0,
  renda: 0,
  arvores_por_mil: 0,
  area_verde: 0,
  ilha_calor: 0,
  ...extra,
});
const nomes = (ls: ReturnType<typeof ordenar>) => ls.map((l) => l.nome);

describe("pontuação do cenário", () => {
  it("é a média ponderada dos percentis dos critérios ativos", () => {
    const l = pontuar(bairros, semCalor, zerar({ renda: 1, densidade: 3 })).find(
      (x) => x.id === "b-pobre",
    )!;
    // (1 × 1 + 3 × 0,3) ÷ 4
    expect(l.pontuacao).toBeCloseTo(0.475, 6);
    expect(l.contribuicoes.renda).toBeCloseTo(0.25, 6);
    expect(l.contribuicoes.densidade).toBeCloseTo(0.225, 6);
  });

  it("mudar os pesos muda a ordem do ranking", () => {
    const porRenda = ordenar(pontuar(bairros, semCalor, zerar({ renda: 5 })));
    const porDensidade = ordenar(pontuar(bairros, semCalor, zerar({ densidade: 5 })));
    expect(nomes(porRenda)[0]).toBe("Pobre");
    expect(nomes(porDensidade)[0]).toBe("Denso");
  });

  it("bairro sem dado num critério tem esse critério ignorado na média e marcado", () => {
    const linhas = pontuar(bairros, semCalor, zerar({ renda: 2, densidade: 2 }));
    const l = linhas.find((x) => x.id === "b-sem-renda")!;
    expect(l.pontuacao).toBeCloseTo(0.5, 6); // só a densidade (0,5), sem puxar para zero
    expect(l.semDado).toEqual(["renda"]);
    expect(l.contribuicoes.renda).toBeUndefined();
  });

  it("sem nenhum critério com dado, o bairro fica sem pontuação e fora do ranking", () => {
    const sozinhos = [{ ...bairros[3]!, percentis: { ...bairros[3]!.percentis, densidade: null } }];
    const [l] = pontuar(sozinhos, semCalor, zerar({ renda: 3 }));
    expect(l!.pontuacao).toBeNull();
    expect(ordenar([l!])).toEqual([]);
  });

  it("critério indisponível (ilha de calor sem os dados) não entra, mesmo com peso", () => {
    expect(criteriosAtivos(semCalor, zerar({ ilha_calor: 5, renda: 1 }))).toEqual(["renda"]);
    const ordem = ordenar(pontuar(bairros, semCalor, zerar({ ilha_calor: 5, renda: 1 })));
    expect(nomes(ordem)[0]).toBe("Pobre");
    const comDados = ordenar(pontuar(bairros, comCalor, zerar({ ilha_calor: 5 })));
    expect(nomes(comDados)[0]).toBe("Quente");
  });

  it("com todos os pesos em zero não há pontuação", () => {
    expect(ordenar(pontuar(bairros, semCalor, zerar({})))).toEqual([]);
  });
});

describe("classes do mapa", () => {
  it("dividem o ranking em quintos, da menor (0) à maior (4) prioridade", () => {
    const muitos = Array.from({ length: 10 }, (_, i) => ({
      id: `b${i}`,
      nome: `B${String(i).padStart(2, "0")}`,
      pontuacao: 1 - i / 10,
      contribuicoes: {},
      semDado: [],
    }));
    const classes = classesDePrioridade(muitos);
    expect(classes.get("b0")).toBe(4);
    expect(classes.get("b1")).toBe(4);
    expect(classes.get("b4")).toBe(2);
    expect(classes.get("b9")).toBe(0);
    expect(new Set(classes.values()).size).toBe(5);
  });
});

describe("cenários prontos", () => {
  it("Equilibrado tem todos os pesos iguais", () => {
    const p = CENARIOS[0]!.pesos(true);
    expect(new Set(Object.values(p)).size).toBe(1);
  });

  it("Equidade dá mais peso à renda e à arborização", () => {
    const p = CENARIOS.find((c) => c.id === "equidade")!.pesos(true);
    expect(p.renda).toBeGreaterThan(p.densidade);
    expect(p.arborizacao).toBeGreaterThan(p.densidade);
    expect(p.renda).toBeGreaterThanOrEqual(p.arborizacao);
  });

  it("Calor e densidade usa o calor se houver; senão, a arborização", () => {
    const c = CENARIOS.find((x) => x.id === "calor_densidade")!;
    const com = c.pesos(true);
    expect(com.ilha_calor).toBe(5);
    expect(com.densidade).toBe(5);
    expect(com.arborizacao).toBeLessThan(5);
    const sem = c.pesos(false);
    expect(sem.arborizacao).toBe(5);
    expect(sem.densidade).toBe(5);
  });

  it("reconhece qual cenário pronto os pesos atuais formam", () => {
    expect(cenarioAtivo(igual, semCalor)).toBe("equilibrado");
    expect(cenarioAtivo(CENARIOS[1]!.pesos(false), semCalor)).toBe("equidade");
    expect(cenarioAtivo({ ...igual, renda: 4 }, semCalor)).toBeNull();
  });
});

describe("pesos na URL", () => {
  it("só os pesos fora do padrão vão para a URL, e voltam iguais", () => {
    const pesos = { ...igual, renda: 5, densidade: 0, ilha_calor: 1 };
    const busca = buscaDosPesos(pesos);
    expect(busca).toEqual({
      arborizacao: undefined,
      densidade: 0,
      renda: 5,
      arvores: undefined,
      verde: undefined,
      calor: 1,
    });
    expect(pesosDaBusca(busca)).toEqual(pesos);
  });

  it("sem parâmetros vale o padrão e valores fora da faixa são limitados", () => {
    expect(pesosDaBusca({})).toEqual(igual);
    expect(pesosDaBusca({ renda: 9, densidade: -2 })).toMatchObject({ renda: 5, densidade: 0 });
  });
});

describe("exportação", () => {
  it("o CSV traz o ranking, os pesos e as fontes", () => {
    const pesos = zerar({ renda: 5, densidade: 2 });
    const ordenadas = ordenar(pontuar(bairros, semCalor, pesos));
    const csv = csvDoCenario(ordenadas, bairros, semCalor, pesos, "21/11/2026 12:00");
    expect(csv).toContain("não é índice oficial (DP-14)");
    expect(csv).toContain("Renda 5");
    expect(csv).toContain("Ilha de calor 0 (indisponível)");
    expect(csv).toContain("IBGE, Censo Demográfico 2022 (renda), 2022");
    const linhas = csv.split("\r\n").filter((l) => l && !l.startsWith("#") && !l.startsWith("﻿#"));
    // cabeçalho + 4 bairros
    expect(linhas).toHaveLength(5);
    expect(linhas[1]).toMatch(/^1;Pobre;/);
    // O bairro sem renda aparece, com o critério ativo sem dado marcado.
    expect(linhas.find((l) => l.includes("Sem renda"))).toContain("Renda");
  });
});

describe("formato dos valores", () => {
  it("usa unidade e formato brasileiro", () => {
    expect(formatarValor("arborizacao", 45.25)).toBe("45,3%");
    expect(formatarValor("densidade", 9000)).toBe("9.000 hab/km²");
    expect(formatarValor("renda", 1234.4)).toBe("R$ 1.234");
    expect(formatarValor("area_verde", 12.34)).toBe("12,3 m²/hab.");
    expect(formatarValor("ilha_calor", 3.2)).toBe("+3,2 °C");
    expect(formatarValor("renda", null)).toBe("Sem dado");
  });
});
