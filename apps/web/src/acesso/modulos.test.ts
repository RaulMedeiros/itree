import { describe, expect, it } from "vitest";

import { modulosVisiveis } from "./modulos";

describe("modulosVisiveis", () => {
  it("mostra só módulos com permissão", () => {
    const ids = modulosVisiveis(["admin.usuarios"], true).map((m) => m.id);
    expect(ids).toEqual(["administracao"]);
  });

  it("oculta módulos de fases não entregues quando desabilitado (produção)", () => {
    const permissoes = ["mapa.ler", "inventario.ler", "admin.auditoria"];
    expect(modulosVisiveis(permissoes, false).map((m) => m.id)).toEqual(["administracao"]);
    expect(modulosVisiveis(permissoes, true).map((m) => m.id)).toEqual([
      "visao-geral",
      "mapa",
      "inventario",
      "administracao",
    ]);
  });

  it("marca módulos entregues", () => {
    const [admin] = modulosVisiveis(["admin.equipes"], false);
    expect(admin?.entregue).toBe(true);
  });
});
