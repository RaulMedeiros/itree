import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Linha, Tabela, Td, Th } from "./tabela";

function medidas(largura: number, visivel: number) {
  const proto = HTMLElement.prototype;
  Object.defineProperty(proto, "scrollWidth", { configurable: true, value: largura });
  Object.defineProperty(proto, "clientWidth", { configurable: true, value: visivel });
}

afterEach(() => medidas(0, 0));

function exemplo() {
  return (
    <Tabela>
      <thead>
        <tr>
          <Th dica="Ocorrências abertas com risco confirmado">Com risco</Th>
        </tr>
      </thead>
      <tbody>
        <Linha>
          <Td semQuebra>Joaquim Távora</Td>
        </Linha>
      </tbody>
    </Tabela>
  );
}

describe("Tabela (R3-10)", () => {
  it("mostra a sombra de rolagem quando há colunas escondidas à direita", () => {
    medidas(900, 400);
    render(exemplo());
    expect(screen.getByTestId("mais-colunas")).toBeInTheDocument();
  });

  it("não mostra a sombra quando a tabela cabe", () => {
    medidas(300, 400);
    render(exemplo());
    expect(screen.queryByTestId("mais-colunas")).toBeNull();
  });

  it("cabeçalho não quebra e guarda o rótulo completo na dica", () => {
    render(exemplo());
    const th = screen.getByRole("columnheader", { name: "Com risco" });
    expect(th).toHaveClass("whitespace-nowrap");
    expect(th).toHaveAttribute("title", "Ocorrências abertas com risco confirmado");
  });

  it("nomes de pessoa e bairro ficam numa linha só", () => {
    render(exemplo());
    expect(screen.getByRole("cell", { name: "Joaquim Távora" })).toHaveClass("whitespace-nowrap");
  });
});

describe("Tabela em cartões no celular", () => {
  function lista() {
    return (
      <Tabela>
        <thead>
          <tr>
            <Th className="w-10">
              <input type="checkbox" aria-label="Selecionar todas" />
            </Th>
            <Th>Código</Th>
            <Th>Espécie</Th>
            <Th cartao="oculta">Atualizado em</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          <Linha>
            <Td>
              <input type="checkbox" aria-label="Selecionar ARV-1" />
            </Td>
            <Td>ARV-1</Td>
            <Td>Ipê-amarelo</Td>
            <Td>12/11/2026</Td>
            <Td>
              <a href="/arvore">Abrir</a>
            </Td>
          </Linha>
        </tbody>
      </Tabela>
    );
  }

  it("marca a classe que o CSS usa para desenhar cartões", () => {
    render(lista());
    expect(screen.getByRole("table")).toHaveClass("tabela-cartoes");
  });

  it("a primeira coluna com cabeçalho é o título do cartão, sem rótulo", () => {
    render(lista());
    const codigo = screen.getByRole("cell", { name: "ARV-1" });
    expect(codigo).toHaveAttribute("data-titulo");
    expect(codigo).not.toHaveAttribute("data-rotulo");
  });

  it("copia o cabeçalho das outras colunas para a célula, como rótulo do cartão", () => {
    render(lista());
    expect(screen.getByRole("cell", { name: "Ipê-amarelo" })).toHaveAttribute(
      "data-rotulo",
      "Espécie",
    );
  });

  it("esconde no cartão as colunas marcadas como ocultas, mas as mantém na tabela", () => {
    render(lista());
    const celula = screen.getByRole("cell", { name: "12/11/2026" });
    expect(celula).toHaveAttribute("data-oculta");
    expect(screen.getByRole("columnheader", { name: "Atualizado em" })).toHaveAttribute(
      "data-cartao",
      "oculta",
    );
  });

  it("a coluna de seleção e a de ação não ganham rótulo nem título", () => {
    render(lista());
    const caixa = screen.getByRole("checkbox", { name: "Selecionar ARV-1" }).closest("td")!;
    const acao = screen.getByRole("link", { name: "Abrir" }).closest("td")!;
    for (const c of [caixa, acao]) {
      expect(c).not.toHaveAttribute("data-rotulo");
      expect(c).not.toHaveAttribute("data-titulo");
    }
  });

  it("rotula também as linhas de uma página nova", () => {
    const { rerender } = render(lista());
    rerender(
      <Tabela>
        <thead>
          <tr>
            <Th>Código</Th>
            <Th>Espécie</Th>
          </tr>
        </thead>
        <tbody>
          <Linha>
            <Td>ARV-2</Td>
            <Td>Oiti</Td>
          </Linha>
        </tbody>
      </Tabela>,
    );
    expect(screen.getByRole("cell", { name: "Oiti" })).toHaveAttribute("data-rotulo", "Espécie");
  });
});
