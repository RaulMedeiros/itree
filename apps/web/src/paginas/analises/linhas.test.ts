import { describe, expect, it } from "vitest";

import { ROTULO_SEM_VALOR, ROTULO_VALOR, gerarCsv, ordenarLinhas, separarZeros } from "./linhas";

const linhas = [
  { rotulo: "A", valor: 5 },
  { rotulo: "B", valor: 0 },
  { rotulo: "C", valor: 2 },
  { rotulo: "D", valor: 0 },
];

describe("separarZeros (R3-14)", () => {
  it("por bairro, leva os zeros para um grupo à parte e mantém a ordem", () => {
    const { principais, zeros } = separarZeros(linhas, true, false);
    expect(principais.map((l) => l.rotulo)).toEqual(["A", "C"]);
    expect(zeros.map((l) => l.rotulo)).toEqual(["B", "D"]);
  });

  it("fora da análise por bairro, nada é recolhido", () => {
    expect(separarZeros(linhas, false, false).zeros).toEqual([]);
  });

  it("percentual de 0% é valor medido: não se recolhe", () => {
    expect(separarZeros(linhas, true, true).zeros).toEqual([]);
  });

  it("se tudo é zero, a tabela principal não fica vazia", () => {
    const todos = [{ rotulo: "A", valor: 0 }];
    expect(separarZeros(todos, true, false)).toEqual({ principais: todos, zeros: [] });
  });
});

describe("rótulos das análises de mudas da URBFOR", () => {
  it("dão nome à coluna de valor de cada análise de doação e plantio", () => {
    expect(ROTULO_VALOR["mudas_doadas_por_especie"]).toBe("Mudas doadas");
    expect(ROTULO_VALOR["mudas_doadas_por_categoria"]).toBe("Mudas doadas");
    expect(ROTULO_VALOR["plantios_por_bairro"]).toBe("Mudas plantadas");
  });

  it("o bairro sem plantio vai para um grupo com nome próprio", () => {
    expect(ROTULO_SEM_VALOR["plantios_por_bairro"]).toBe("Sem plantio identificado");
  });
});

describe("ordenarLinhas", () => {
  it("ordena por valor, nos dois sentidos, e por nome, sem mexer no original", () => {
    const original = [...linhas];
    expect(ordenarLinhas(linhas, "maior").map((l) => l.rotulo)).toEqual(["A", "C", "B", "D"]);
    expect(ordenarLinhas(linhas, "menor").map((l) => l.rotulo)).toEqual(["B", "D", "C", "A"]);
    expect(ordenarLinhas([...linhas].reverse(), "nome").map((l) => l.rotulo)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(linhas).toEqual(original);
  });
});

describe("gerarCsv", () => {
  const colunas = [
    { chave: "rotulo", rotulo: "Bairro" },
    { chave: "valor", rotulo: "Árvores por 1.000 habitantes" },
  ];
  const meta = {
    titulo: "Árvores por 1.000 habitantes",
    fonte: "IBGE e iTree",
    calculadoEm: "21/11/2026",
    ressalvas: ["Conta só as árvores cadastradas."],
  };

  it("leva os comentários com a ressalva, o cabeçalho e uma linha por bairro, com vírgula decimal", () => {
    const csv = gerarCsv(colunas, [{ rotulo: "Aldeota", valor: 0.09 }], meta);
    expect(csv.startsWith("\ufeff# Árvores por 1.000 habitantes\r\n")).toBe(true);
    expect(csv).toContain("# ressalva: Conta só as árvores cadastradas.");
    expect(csv).toContain("Bairro;Árvores por 1.000 habitantes\r\nAldeota;0,09\r\n");
  });

  it("protege texto que viraria fórmula e escapa aspas e ponto e vírgula", () => {
    const csv = gerarCsv(colunas, [{ rotulo: '=CMD("x");y', valor: 1 }], meta);
    expect(csv).toContain(`"'=CMD(""x"");y";1`);
  });
});
