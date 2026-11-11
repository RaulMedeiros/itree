import type { EventoAuditoria } from "@itree/api-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LinhaDoTempo } from "./Historico";
import { formatarValorCampo, rotuloDoCampo } from "./historicoFormatos";

function evento(parcial: Partial<EventoAuditoria>): EventoAuditoria {
  return {
    id: "e1",
    momento: "2026-11-10T21:17:00Z",
    entidade: "Medida",
    entidade_modelo: "inventario.MedidaEvent",
    objeto_id: "1",
    registro: null,
    pai: null,
    acao: "criacao",
    diferencas: null,
    dados: {},
    autor_nome: "Gabriel Gestor",
    contexto: { origem: "web" },
    ...parcial,
  };
}

describe("histórico legível", () => {
  it("troca chaves técnicas e valores internos por rótulos e datas pt-BR", () => {
    render(
      <LinhaDoTempo
        carregando={false}
        eventos={[
          evento({
            dados: {
              tipo: "dap",
              metodo: "fita_diametrica",
              aplicada: false,
              data_medicao: "2026-11-05",
              precisao_m: "5.4",
              sinais: ["conflito_rede", "galhos_secos", "inclinacao"],
              observacao: "",
              id: 9,
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Método")).toBeInTheDocument();
    expect(screen.getByText("Fita diamétrica")).toBeInTheDocument();
    expect(screen.getByText("DAP")).toBeInTheDocument();
    expect(screen.getByText("Aplicada ao cadastro")).toBeInTheDocument();
    expect(screen.getByText("Não")).toBeInTheDocument();
    expect(screen.getByText("05/11/2026")).toBeInTheDocument();
    expect(screen.getByText("5,4 m")).toBeInTheDocument();
    expect(
      screen.getByText("Conflito com rede aérea, Galhos secos, Inclinação perceptível"),
    ).toBeInTheDocument();
    // Nada de snake_case, ISO nem "(vazio)".
    expect(document.body.textContent).not.toMatch(/_|\d{4}-\d{2}-\d{2}|\(vazio\)/);
  });

  it("mostra o que mudou com rótulos humanos", () => {
    render(
      <LinhaDoTempo
        carregando={false}
        eventos={[
          evento({
            entidade: "Ocorrência",
            entidade_modelo: "ocorrencias.OcorrenciaEvent",
            acao: "alteracao",
            diferencas: {
              prioridade: ["", "baixa"],
              estado: ["encaminhada", "em_atendimento"],
              atualizado_em: ["2026-11-01T10:00:00Z", "2026-11-10T10:00:00Z"],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByRole("rowheader", { name: "Prioridade" })).toBeInTheDocument();
    expect(screen.getByText("Baixa")).toBeInTheDocument();
    expect(screen.getByText("Em atendimento")).toBeInTheDocument();
    expect(screen.getByText("Encaminhada")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("Atualizado em")).not.toBeInTheDocument();
  });

  it("não exibe tabela vazia quando nenhuma mudança é visível", () => {
    render(
      <LinhaDoTempo
        carregando={false}
        eventos={[
          evento({
            acao: "alteracao",
            diferencas: { atualizado_em: ["2026-11-01T10:00:00Z", "2026-11-10T10:00:00Z"] },
          }),
        ]}
      />,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/sem mudança em campos exibidos/)).toBeInTheDocument();
  });
});

describe("formatarValorCampo", () => {
  it("usa o enum conforme a entidade e cai em texto legível quando desconhecido", () => {
    expect(formatarValorCampo("estado", "em_revisao", "inspecoes.InspecaoEvent")).toBe(
      "Em revisão",
    );
    expect(formatarValorCampo("estado", "nao_iniciada", "tarefas.TarefaEvent")).toBe(
      "Não iniciada",
    );
    expect(formatarValorCampo("estado", "valor_novo", "x.YEvent")).toBe("Valor novo");
    expect(formatarValorCampo("risco_confirmado", true)).toBe("Sim");
    expect(formatarValorCampo("prazo", "2026-11-30")).toBe("30/11/2026");
    expect(formatarValorCampo("sinais", [])).toBe("—");
    expect(rotuloDoCampo("campo_inedito")).toBe("Campo inedito");
  });
});
