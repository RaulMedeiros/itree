import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
