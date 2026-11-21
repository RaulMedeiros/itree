import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dialogo } from "./dialogo";

describe("Dialogo", () => {
  it("flutua com margem por padrão, também no celular", () => {
    render(
      <Dialogo aberto aoMudar={() => {}} titulo="Exemplo">
        Conteúdo
      </Dialogo>,
    );
    expect(screen.getByRole("dialog")).not.toHaveClass("max-md:h-dvh");
  });

  it("com telaCheiaNoCelular ocupa a tela toda abaixo de md, sem mexer no desktop", () => {
    render(
      <Dialogo aberto aoMudar={() => {}} titulo="Exemplo" telaCheiaNoCelular>
        Conteúdo
      </Dialogo>,
    );
    const dialogo = screen.getByRole("dialog");
    expect(dialogo).toHaveClass("max-md:inset-0", "max-md:h-dvh", "max-md:w-full");
    expect(dialogo).toHaveClass("rounded-lg", "top-1/2");
  });

  it("o botão de fechar tem alvo de toque de 44 px no celular", () => {
    render(
      <Dialogo aberto aoMudar={() => {}} titulo="Exemplo">
        Conteúdo
      </Dialogo>,
    );
    expect(screen.getByRole("button", { name: "Fechar diálogo" })).toHaveClass("max-md:size-11");
  });
});
