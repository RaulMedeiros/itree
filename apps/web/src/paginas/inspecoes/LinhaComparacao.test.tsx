import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LinhaComparacao, TabelaComparacao } from "./LinhaComparacao";

function tabela(destaque: boolean, anterior?: string) {
  return render(
    <TabelaComparacao
      cabecalho={
        <tr>
          <th />
          <th>Esta inspeção</th>
        </tr>
      }
    >
      <LinhaComparacao
        campo="Condição aparente"
        inspecao="Ruim"
        cadastro="Boa"
        anterior={anterior}
        destaque={destaque}
      />
    </TabelaComparacao>,
  );
}

describe("comparação da revisão no celular", () => {
  it("empilha os blocos e esconde o cabeçalho abaixo de md", () => {
    tabela(false);
    expect(screen.getByRole("table")).toHaveClass("max-md:block");
    expect(screen.getAllByRole("rowgroup")[0]).toHaveClass("max-md:sr-only");
    expect(screen.getByRole("row", { name: /Condição aparente/ })).toHaveClass(
      "max-md:block",
      "max-md:border",
    );
    expect(screen.getByRole("cell", { name: "Ruim" })).toHaveClass("max-md:block");
  });

  it("rotula cada valor empilhado com a coluna de que veio", () => {
    tabela(false, "Regular");
    expect(screen.getByRole("cell", { name: "Ruim" })).toHaveAttribute(
      "data-rotulo",
      "Esta inspeção",
    );
    expect(screen.getByRole("cell", { name: "Boa" })).toHaveAttribute(
      "data-rotulo",
      "Cadastro atual",
    );
    expect(screen.getByRole("cell", { name: "Regular" })).toHaveAttribute(
      "data-rotulo",
      "Inspeção anterior",
    );
  });

  it("sem inspeção anterior não cria a terceira coluna", () => {
    tabela(false);
    expect(screen.queryByText("Inspeção anterior")).toBeNull();
    expect(document.querySelector('[data-rotulo="Inspeção anterior"]')).toBeNull();
  });

  it("destaca o bloco do que mudou, com o selo 'Mudou'", () => {
    tabela(true);
    const linha = screen.getByRole("row", { name: /Condição aparente/ });
    expect(linha).toHaveAttribute("data-mudou");
    expect(linha).toHaveClass("max-md:bg-marca-clara", "max-md:border-marca");
    expect(screen.getByText("Mudou")).toBeInTheDocument();
  });

  it("o que não mudou fica sem destaque e sem selo", () => {
    tabela(false);
    const linha = screen.getByRole("row", { name: /Condição aparente/ });
    expect(linha).not.toHaveAttribute("data-mudou");
    expect(linha).not.toHaveClass("max-md:bg-marca-clara");
    expect(screen.queryByText("Mudou")).toBeNull();
  });
});
