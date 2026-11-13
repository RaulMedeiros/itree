import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Codigo, Medida } from "../ui/codigo";
import { Selo } from "../ui/selo";
import {
  SeloEstadoOcorrencia,
  SeloLocalizacao,
  SeloOrigemValor,
  SeloPrioridade,
  SeloStatusAlerta,
} from "./selos";

describe("selos (R3-05)", () => {
  it("tem dois tamanhos, e o pequeno é o padrão", () => {
    render(
      <>
        <Selo>padrão</Selo>
        <Selo tamanho="md">grande</Selo>
      </>,
    );
    expect(screen.getByText("padrão")).toHaveClass("text-xs");
    expect(screen.getByText("grande")).toHaveClass("text-sm", "px-2.5");
  });

  it("os selos de domínio aceitam o tamanho e o aplicam", () => {
    render(
      <>
        <SeloPrioridade prioridade="baixa" tamanho="md" />
        <SeloEstadoOcorrencia estado="em_atendimento" tamanho="md" />
      </>,
    );
    expect(screen.getByText("Prioridade baixa")).toHaveClass("text-sm");
    expect(screen.getByText("Em atendimento")).toHaveClass("text-sm");
  });

  it("alerta detectado é violeta, a cor do alerta no mapa, e não âmbar", () => {
    render(<SeloStatusAlerta status="detectado" />);
    const selo = screen.getByText("Alerta detectado");
    expect(selo).toHaveClass("text-alerta", "bg-alerta-clara");
    expect(selo).not.toHaveClass("text-atencao");
  });

  it("'importado' tem a mesma cor na origem do valor e na da localização", () => {
    render(
      <>
        <SeloOrigemValor origem="importado" />
        <SeloLocalizacao origem="importada" />
      </>,
    );
    expect(screen.getByText("Importado")).toHaveClass("text-info");
    expect(screen.getByText("Importada")).toHaveClass("text-info");
  });
});

describe("códigos e medidas (R3-06)", () => {
  it("o código usa sempre a mesma fonte, tamanho e cor", () => {
    render(<Codigo>ARV-000058</Codigo>);
    expect(screen.getByText("ARV-000058")).toHaveClass(
      "font-mono",
      "text-[13px]",
      "text-marca-escura",
    );
  });

  it("a medida fica na fonte do texto, com algarismos tabulares", () => {
    render(<Medida>38 cm</Medida>);
    const medida = screen.getByText("38 cm");
    expect(medida).toHaveClass("tabular-nums");
    expect(medida).not.toHaveClass("font-mono");
  });
});
