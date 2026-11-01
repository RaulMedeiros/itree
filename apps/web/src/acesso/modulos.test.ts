import { describe, expect, it } from "vitest";

import { modulosVisiveis } from "./modulos";

describe("modulosVisiveis", () => {
  it("mostra só módulos com permissão", () => {
    const ids = modulosVisiveis(["admin.usuarios"], true).map((m) => m.id);
    expect(ids).toEqual(["administracao"]);
  });

  it("oculta módulos de fases não entregues quando desabilitado (produção)", () => {
    const permissoes = ["mapa.ler", "inventario.ler", "admin.auditoria"];
    expect(modulosVisiveis(permissoes, false).map((m) => m.id)).toEqual([
      "visao-geral",
      "mapa",
      "inventario",
      "administracao",
    ]);
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

describe("parâmetros de URL", () => {
  it("aceita bandeiras digitadas na URL (?tarefas=1, ?atrasadas=true)", async () => {
    const { criarRoteador } = await import("../rotas");
    const { createMemoryHistory } = await import("@tanstack/react-router");
    const roteador = criarRoteador(
      createMemoryHistory({ initialEntries: ["/mapa?tarefas=1&arvores=0"] }),
    );
    await roteador.load().catch(() => undefined);
    const busca = roteador.state.matches[roteador.state.matches.length - 1]?.search;
    expect(busca).toMatchObject({ tarefas: "1", arvores: "0" });
  });
});
