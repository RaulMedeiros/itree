import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraficoMensal } from "./graficos";
import { mesEmAndamento } from "./mes";

const meses = ["2026-09", "2026-10", "2026-11"];
const series = [{ id: "a", rotulo: "Inspeções", valores: [8, 9, 2] }];

describe("mês em andamento (R3-18)", () => {
  it("é o último mês da série quando coincide com o mês do cálculo", () => {
    expect(mesEmAndamento(meses, "2026-11-14T12:00:00Z")).toBe("2026-11");
    expect(mesEmAndamento(meses, "2026-12-01T12:00:00Z")).toBeNull();
    expect(mesEmAndamento([], "2026-11-14T12:00:00Z")).toBeNull();
    expect(mesEmAndamento(meses, undefined)).toBeNull();
  });

  it("marca o rótulo como parcial e vaza o último ponto", () => {
    render(<GraficoMensal meses={meses} series={series} parcial="2026-11" />);
    expect(screen.getByLabelText(/nov\/26 \(parcial\): Inspeções 2/)).toBeInTheDocument();
    expect(screen.getByTestId("ponto-parcial")).toHaveAttribute("fill", "#fff");
  });

  it("sem mês parcial, o último ponto é cheio e o rótulo não muda", () => {
    render(<GraficoMensal meses={meses} series={series} />);
    expect(screen.queryByTestId("ponto-parcial")).toBeNull();
    expect(screen.getByLabelText(/nov\/26: Inspeções 2/)).toBeInTheDocument();
  });
});

describe("gráfico mensal em tela estreita (375 px)", () => {
  const doze = Array.from({ length: 12 }, (_, n) => `2026-${String(n + 1).padStart(2, "0")}`);
  const umaSerie = [{ id: "a", rotulo: "Inspeções", valores: doze.map((_, n) => n + 1) }];

  function medir(largura: number) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      value: largura,
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 0 });
  });

  const rotulosDoEixo = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("svg > text")).map((t) => t.textContent);

  it("desenha na largura do contêiner, sem encolher o texto", () => {
    medir(343);
    const { container } = render(<GraficoMensal meses={doze} series={umaSerie} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 343 240");
  });

  it("aumenta a fonte dos eixos no celular", () => {
    medir(343);
    const { container } = render(<GraficoMensal meses={doze} series={umaSerie} />);
    const eixo = container.querySelector("svg > g text")!;
    expect(eixo).toHaveAttribute("font-size", "12");
  });

  it("mostra menos marcas de mês no celular que no desktop, sempre incluindo o último", () => {
    const { container: desktop, unmount } = render(
      <GraficoMensal meses={doze} series={umaSerie} />,
    );
    const marcasDesktop = rotulosDoEixo(desktop).filter((t) => t?.includes("/26"));
    unmount();
    medir(343);
    const { container: celular } = render(<GraficoMensal meses={doze} series={umaSerie} />);
    const marcasCelular = rotulosDoEixo(celular).filter((t) => t?.includes("/26"));
    expect(marcasDesktop).toHaveLength(6);
    expect(marcasCelular.length).toBeLessThan(marcasDesktop.length);
    expect(marcasCelular.at(-1)).toBe("dez/26");
  });

  it("no desktop (640 px) a fonte dos eixos continua em 10", () => {
    medir(640);
    const { container } = render(<GraficoMensal meses={doze} series={umaSerie} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 640 220");
    expect(container.querySelector("svg > g text")).toHaveAttribute("font-size", "10");
  });
});
