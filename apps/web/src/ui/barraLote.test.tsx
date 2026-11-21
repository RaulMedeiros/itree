import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BarraAcoesLote } from "./barraLote";

describe("BarraAcoesLote", () => {
  it("fica fixa no rodapé abaixo de md e solta no desktop", () => {
    render(<BarraAcoesLote>2 selecionadas</BarraAcoesLote>);
    const barra = screen.getByRole("region", { name: "Ações da seleção" });
    expect(barra).toHaveClass("max-md:fixed", "max-md:bottom-0", "max-md:inset-x-0");
    expect(barra).not.toHaveClass("fixed");
  });

  it("reserva espaço embaixo do conteúdo enquanto está na tela e o devolve ao sair", () => {
    const { unmount } = render(<BarraAcoesLote>2 selecionadas</BarraAcoesLote>);
    expect(document.documentElement.style.getPropertyValue("--altura-barra-lote")).toBe("0px");
    unmount();
    expect(document.documentElement.style.getPropertyValue("--altura-barra-lote")).toBe("");
  });
});
