import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarServidor } from "./servidorPadrao";

const API = "http://api.teste";
const servidor = criarServidor(
  http.get(`${API}/api/v1/notificacoes/contagem`, () => HttpResponse.json({ nao_lidas: 7 })),
);

beforeAll(() => servidor.listen({ onUnhandledRequest: "error" }));
afterAll(() => servidor.close());

describe("servidor de testes padrão", () => {
  it("responde à lista de notificações sem handler no teste", async () => {
    const resposta = await fetch(`${API}/api/v1/notificacoes`);
    expect(await resposta.json()).toMatchObject({ count: 0, results: [] });
  });

  it("o handler do próprio teste vale mais que o padrão", async () => {
    const resposta = await fetch(`${API}/api/v1/notificacoes/contagem`);
    expect(await resposta.json()).toEqual({ nao_lidas: 7 });
  });
});
