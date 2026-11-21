import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AjudaTermo } from "../componentes/AjudaTermo";
import { Botao } from "./botao";
import { Dica } from "./dica";
import { MenuAcoes } from "./menu";

/**
 * Alvos de toque no celular: 44 px (`size-11`/`h-11`) só abaixo de `md`. O desktop mantém o
 * tamanho compacto, então as classes de desktop continuam e as do celular entram com `max-md:`.
 */
describe("alvos de toque abaixo de md", () => {
  it("botão pequeno de linha de lista ou cartão tem 44 px de altura no celular e 32 px no desktop", () => {
    render(<Botao tamanho="pequeno">Abrir</Botao>);
    expect(screen.getByRole("button", { name: "Abrir" })).toHaveClass("h-8", "max-md:h-11");
  });

  it("botão normal e de ícone também", () => {
    render(
      <>
        <Botao>Salvar</Botao>
        <Botao tamanho="icone" aria-label="Mais" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Salvar" })).toHaveClass("max-md:h-11");
    expect(screen.getByRole("button", { name: "Mais" })).toHaveClass("size-9", "max-md:size-11");
  });

  it("o botão '(i)' da dica", () => {
    render(<Dica texto="Explicação" />);
    expect(screen.getByRole("button", { name: "Explicação" })).toHaveClass(
      "size-8",
      "max-md:size-11",
    );
  });

  it("o menu '⋯' de ações da linha", () => {
    render(
      <MenuAcoes rotulo="Ações da linha" itens={[{ rotulo: "Editar", aoEscolher: () => {} }]} />,
    );
    expect(screen.getByRole("button", { name: "Ações da linha" })).toHaveClass(
      "size-8",
      "max-md:size-11",
    );
  });

  it("o '?' do glossário cresce a área de toque sem empurrar o texto ao lado", () => {
    render(<AjudaTermo id="registro_valido" />);
    expect(screen.getByRole("button", { name: /O que é/ })).toHaveClass(
      "size-5",
      "max-md:size-11",
      "max-md:-m-3",
    );
  });
});
