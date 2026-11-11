import type { EventoAuditoria } from "@itree/api-client";
import { describe, expect, it } from "vitest";

import { agruparEventos } from "./auditoria";

const ev = (id: string, parcial: Partial<EventoAuditoria> = {}): EventoAuditoria => ({
  id,
  momento: "2026-11-10T21:17:10Z",
  entidade: "Sugestão de IA",
  entidade_modelo: "qualidade.InferenciaIAEvent",
  objeto_id: id,
  registro: null,
  pai: null,
  acao: "criacao",
  diferencas: null,
  dados: {},
  autor_nome: null,
  contexto: null,
  ...parcial,
});

describe("agruparEventos", () => {
  it("agrupa eventos iguais do mesmo minuto e separa os diferentes", () => {
    const itens = agruparEventos([
      ev("1"),
      ev("2"),
      ev("3"),
      ev("4"),
      ev("5", { acao: "alteracao" }),
      ev("6", { momento: "2026-11-10T21:30:00Z" }),
    ]);
    expect(itens.map((i) => i.eventos.length)).toEqual([4, 1, 1]);
  });

  it("não junta filhos de pais diferentes, mesmo no mesmo minuto e com a mesma ação", () => {
    const pai = (id: string, codigo: string) => ({ tipo: "arvore", id, codigo });
    const itens = agruparEventos([
      ev("1", { pai: pai("a-1", "ARV-000001") }),
      ev("2", { pai: pai("a-1", "ARV-000001") }),
      ev("3", { pai: pai("a-2", "ARV-000002") }),
      ev("4", { pai: pai("a-2", "ARV-000002") }),
    ]);
    expect(itens.map((i) => i.eventos.map((e) => e.id))).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });
});
