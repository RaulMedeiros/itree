import { describe, expect, it } from "vitest";

import { separarZeros } from "./linhas";

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
