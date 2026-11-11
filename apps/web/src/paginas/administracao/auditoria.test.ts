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
});
