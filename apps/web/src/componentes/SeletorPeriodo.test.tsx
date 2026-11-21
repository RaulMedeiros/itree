import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SeletorPeriodo } from "./SeletorPeriodo";

describe("SeletorPeriodo no celular", () => {
  it("as duas datas dividem a linha e os atalhos rolam na horizontal, com alvo de 44 px", () => {
    render(<SeletorPeriodo inicio="2026-01-01" fim="2026-11-01" aoMudar={vi.fn()} />);
    for (const rotulo of ["De", "até"]) {
      const campo = screen.getByLabelText(rotulo);
      expect(campo).toHaveClass("max-md:w-full", "max-md:min-w-0");
      expect(campo.closest("label")).toHaveClass("max-md:flex-1", "max-md:min-w-0");
    }
    const atalhos = screen.getByRole("group", { name: "Atalhos de período" });
    expect(atalhos).toHaveClass("max-md:w-full", "max-md:overflow-x-auto");
    for (const botao of atalhos.querySelectorAll("button"))
      expect(botao).toHaveClass("max-md:min-h-11", "max-md:shrink-0");
  });
});
