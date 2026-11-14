import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Dica } from "./dica";

describe("Dica (R3-32)", () => {
  it("guarda o texto no nome do botão e o mostra ao clicar", async () => {
    const usuario = userEvent.setup();
    render(<Dica texto="Desfazer indisponível: há inspeção registrada." />);
    const botao = screen.getByRole("button", { name: /Desfazer indisponível/ });
    expect(screen.queryByRole("note")).toBeNull();
    await usuario.click(botao);
    expect(screen.getByRole("note")).toHaveTextContent("há inspeção registrada");
    expect(botao).toHaveAttribute("aria-expanded", "true");
    await usuario.click(botao);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
