import type { EventoAuditoria } from "@itree/api-client";
import { describe, expect, it } from "vitest";

import { usuarioAfetado } from "./auditoria";

const ev = (parcial: Partial<EventoAuditoria>): EventoAuditoria => ({
  id: "1",
  momento: "2026-11-10T21:17:10Z",
  entidade: "Usuário",
  entidade_modelo: "contas.UsuarioEvent",
  objeto_id: "u-1",
  registro: null,
  pai: null,
  acao: "alteracao",
  diferencas: null,
  dados: {},
  autor_nome: null,
  contexto: null,
  ...parcial,
});

describe("usuarioAfetado", () => {
  it("usa o nome do usuário, ou o e-mail se não houver nome", () => {
    expect(usuarioAfetado(ev({ dados: { nome: "Bia", email: "b@x.y" } }))).toBe("Bia");
    expect(usuarioAfetado(ev({ dados: { nome: "", email: "b@x.y" } }))).toBe("b@x.y");
  });

  it("em escopo e membro de equipe, resolve pelo usuario_id", () => {
    const nomes = new Map([["u-9", "Caio"]]);
    const e = ev({ entidade_modelo: "contas.MembroEquipeEvent", dados: { usuario_id: "u-9" } });
    expect(usuarioAfetado(e, nomes)).toBe("Caio");
    expect(usuarioAfetado(e)).toBeNull();
  });

  it("não identifica usuário em outras entidades", () => {
    expect(usuarioAfetado(ev({ entidade_modelo: "inventario.ArvoreEvent" }))).toBeNull();
  });
});
