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
