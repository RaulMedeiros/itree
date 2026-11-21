import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Botao } from "./botao";
import { simularCelular } from "../testes/celular";
import { BarraFiltros, Entrada, FiltrosEmLinha, LinhaFormulario } from "./campos";
import { Recolhivel } from "./recolhivel";

describe("Botao em linha de formulário (R3-07)", () => {
  it("tem a altura dos campos ao lado, mesmo pedindo tamanho pequeno", () => {
    render(
      <LinhaFormulario>
        <Entrada aria-label="Busca" />
        <Botao tamanho="pequeno">Buscar</Botao>
      </LinhaFormulario>,
    );
    expect(screen.getByRole("button", { name: "Buscar" })).toHaveClass("h-9");
    expect(screen.getByRole("button", { name: "Buscar" })).not.toHaveClass("h-8");
  });

  it("fora de uma linha de formulário o tamanho pequeno continua valendo (linhas de tabela)", () => {
    render(<Botao tamanho="pequeno">Abrir</Botao>);
    expect(screen.getByRole("button", { name: "Abrir" })).toHaveClass("h-8");
  });
});

describe("Recolhivel (R3-08)", () => {
  it("troca o triângulo do navegador por um chevron e abre ao clicar", async () => {
    render(<Recolhivel titulo="Detalhes técnicos">conteúdo</Recolhivel>);
    const resumo = screen.getByText("Detalhes técnicos").closest("summary")!;
    expect(resumo).toHaveClass("list-none", "min-h-9");
    expect(resumo.querySelector("svg")).not.toBeNull();
    const detalhes = resumo.closest("details")!;
    expect(detalhes).not.toHaveAttribute("open");
    await userEvent.click(resumo);
    expect(detalhes).toHaveAttribute("open");
  });
});

describe("BarraFiltros (R3-09)", () => {
  const filtros = (n: number) =>
    Array.from({ length: n }, (_, i) => <Entrada key={i} aria-label={`Filtro ${i + 1}`} />);

  it("mostra até 4 filtros numa linha, sem 'Mais filtros' quando não há mais", () => {
    render(<BarraFiltros principais={filtros(3)} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
    expect(screen.queryByText("Mais filtros")).toBeNull();
  });

  it("manda o que passa de 4 para 'Mais filtros'", () => {
    render(<BarraFiltros principais={filtros(6)} />);
    const mais = screen.getByText("Mais filtros").closest("details")!;
    expect(within(mais).getAllByRole("textbox")).toHaveLength(2);
    // Os 4 primeiros ficam fora do recolhível.
    const fora = screen.getAllByRole("textbox").filter((c) => !mais.contains(c));
    expect(fora).toHaveLength(4);
  });

  it("abre 'Mais filtros' e conta os ativos quando há filtro de dentro em uso", () => {
    render(<BarraFiltros principais={filtros(1)} extras={filtros(2)} extrasAtivos={2} />);
    const mais = screen.getByText("Mais filtros").closest("details")!;
    expect(mais).toHaveAttribute("open");
    expect(within(mais).getByText("2 ativos")).toBeInTheDocument();
  });
});

describe("filtros em folha no celular", () => {
  const filtros = (n: number) =>
    Array.from({ length: n }, (_, i) => <Entrada key={i} aria-label={`Filtro ${i + 1}`} />);

  it("troca a barra por um botão 'Filtros (n)' com a contagem dos ativos", () => {
    simularCelular();
    render(<BarraFiltros principais={filtros(3)} ativos={2} />);
    expect(screen.getByRole("button", { name: /Filtros \(2\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("Mais filtros")).toBeNull();
  });

  it("abre a folha com todos os filtros, inclusive os extras, e fecha em 'Ver resultados'", async () => {
    simularCelular();
    render(<BarraFiltros principais={filtros(5)} extras={filtros(1)} ativos={0} />);
    await userEvent.click(screen.getByRole("button", { name: /Filtros \(0\)/ }));
    const folha = await screen.findByRole("dialog", { name: "Filtros" });
    expect(within(folha).getAllByRole("textbox")).toHaveLength(6);
    await userEvent.click(within(folha).getByRole("button", { name: "Ver resultados" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fecha a folha com Esc", async () => {
    simularCelular();
    render(<BarraFiltros principais={filtros(2)} />);
    await userEvent.click(screen.getByRole("button", { name: /Filtros/ }));
    await screen.findByRole("dialog", { name: "Filtros" });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("o valor digitado na folha chega ao controle da página", async () => {
    simularCelular();
    const aoMudar = vi.fn();
    render(
      <BarraFiltros
        principais={[
          <Entrada key="b" aria-label="Buscar" onChange={(e) => aoMudar(e.target.value)} />,
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Filtros/ }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Buscar" }), "ipê");
    expect(aoMudar).toHaveBeenLastCalledWith("ipê");
  });

  it("filtros soltos (FiltrosEmLinha) também viram folha no celular e ficam em linha no desktop", async () => {
    render(
      <FiltrosEmLinha ativos={1}>
        <Entrada aria-label="Responsável" />
      </FiltrosEmLinha>,
    );
    expect(screen.getByRole("textbox", { name: "Responsável" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Filtros/ })).toBeNull();
    cleanup();
    simularCelular();
    render(
      <FiltrosEmLinha ativos={1}>
        <Entrada aria-label="Responsável" />
      </FiltrosEmLinha>,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: /Filtros \(1\)/ })).toBeInTheDocument();
  });

  it("no desktop a barra continua como era, sem o botão", () => {
    render(<BarraFiltros principais={filtros(2)} ativos={1} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Filtros/ })).toBeNull();
  });
});
