import { configurarCliente, type Eu, type PreferenciaNotificacao } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { criarServidor } from "./servidorPadrao";

vi.mock("react-oidc-context", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    signinRedirect: vi.fn(),
    signoutRedirect: vi.fn(),
  }),
  hasAuthParams: () => false,
}));
vi.mock("../autenticacao/gerenciador", () => ({ gerenciadorUsuario: {} }));

const API = "http://api.teste";

const USUARIO: Eu = {
  id: "u-1",
  nome: "Ana Admin",
  email: "ana@itree.teste",
  papeis: ["administrador"],
  permissoes: ["admin.configuracao"],
  territorios: [{ id: "t-for", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "producao",
};

const linha = (tipo: PreferenciaNotificacao["tipo"], rotulo: string): PreferenciaNotificacao => ({
  tipo,
  rotulo,
  ativa: true,
  email: false,
});

let preferencias: PreferenciaNotificacao[] = [];
const envios: unknown[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(USUARIO)),
  http.get(`${API}/api/v1/notificacoes/preferencias`, () => HttpResponse.json(preferencias)),
  http.put(`${API}/api/v1/notificacoes/preferencias`, async ({ request }) => {
    const corpo = (await request.json()) as {
      preferencias: Pick<PreferenciaNotificacao, "tipo" | "ativa" | "email">[];
    };
    envios.push(corpo);
    preferencias = preferencias.map((p) => ({
      ...p,
      ...corpo.preferencias.find((c) => c.tipo === p.tipo),
    }));
    return HttpResponse.json(preferencias);
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "token-teste" });
});
afterEach(() => {
  servidor.resetHandlers();
  envios.length = 0;
});
afterAll(() => servidor.close());

async function abrir(caminho = "/minha-conta") {
  const { criarRoteador } = await import("../rotas");
  const roteador = criarRoteador(createMemoryHistory({ initialEntries: [caminho] }));
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <RouterProvider router={roteador} />
    </QueryClientProvider>,
  );
}

describe("Minha conta e preferências de notificação (M-14)", () => {
  it("abre pelo menu do usuário", async () => {
    preferencias = [linha("alerta_novo", "Alerta ambiental novo")];
    await abrir("/");
    await userEvent.click(await screen.findByRole("button", { name: /Ana Admin/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Minha conta" }));
    expect(await screen.findByRole("heading", { name: "Minha conta" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Notificações" })).toBeInTheDocument();
  });

  it("lista um tipo por linha, com o e-mail desligado por padrão", async () => {
    preferencias = [
      linha("alerta_novo", "Alerta ambiental novo"),
      linha("tarefa_atribuida", "Tarefa atribuída"),
    ];
    await abrir();
    const receber = await screen.findByRole("checkbox", { name: "Receber: Alerta ambiental novo" });
    expect(receber).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Também por e-mail: Alerta ambiental novo" }),
    ).not.toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });

  it("salva ao ligar o e-mail de um tipo", async () => {
    preferencias = [linha("tarefa_atribuida", "Tarefa atribuída")];
    await abrir();
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Também por e-mail: Tarefa atribuída" }),
    );
    await waitFor(() =>
      expect(envios).toEqual([
        { preferencias: [{ tipo: "tarefa_atribuida", ativa: true, email: true }] },
      ]),
    );
    expect(await screen.findByText("Preferências salvas.")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Também por e-mail: Tarefa atribuída" }),
    ).toBeChecked();
  });

  it("desligar o tipo desliga e bloqueia o e-mail", async () => {
    preferencias = [{ ...linha("alerta_novo", "Alerta ambiental novo"), email: true }];
    await abrir();
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Receber: Alerta ambiental novo" }),
    );
    await waitFor(() =>
      expect(envios).toEqual([
        { preferencias: [{ tipo: "alerta_novo", ativa: false, email: false }] },
      ]),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Também por e-mail: Alerta ambiental novo" }),
      ).toBeDisabled(),
    );
  });
});
