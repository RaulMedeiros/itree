import { configurarCliente, type Eu, type Notificacao } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { criarServidor } from "./servidorPadrao";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

const notificacao = (p: Partial<Notificacao>): Notificacao => ({
  id: "n-1",
  tipo: "alerta_novo",
  titulo: "1 novo alerta ambiental",
  texto: "",
  link: "/administracao/integracoes",
  lida: false,
  lida_em: null,
  criado_em: "2026-11-11T12:00:00Z",
  ...p,
});

let notificacoes: Notificacao[] = [];
const chamadas: string[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(USUARIO)),
  http.get(`${API}/api/v1/alertas/ingestoes`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/notificacoes/contagem`, () =>
    HttpResponse.json({ nao_lidas: notificacoes.filter((n) => !n.lida).length }),
  ),
  http.get(`${API}/api/v1/notificacoes`, () =>
    HttpResponse.json({
      count: notificacoes.length,
      next: null,
      previous: null,
      results: notificacoes,
    }),
  ),
  http.post(`${API}/api/v1/notificacoes/ler-todas`, () => {
    chamadas.push("ler-todas");
    notificacoes = notificacoes.map((n) => ({ ...n, lida: true }));
    return HttpResponse.json({ nao_lidas: 0 });
  }),
  http.post(`${API}/api/v1/notificacoes/:id/ler`, ({ params }) => {
    chamadas.push(`ler:${String(params.id)}`);
    notificacoes = notificacoes.map((n) => (n.id === params.id ? { ...n, lida: true } : n));
    return HttpResponse.json(notificacoes.find((n) => n.id === params.id));
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "token-teste" });
});
afterEach(() => {
  servidor.resetHandlers();
  notificacoes = [];
  chamadas.length = 0;
});
afterAll(() => servidor.close());

async function abrir() {
  const { criarRoteador } = await import("../rotas");
  const roteador = criarRoteador(createMemoryHistory({ initialEntries: ["/"] }));
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <RouterProvider router={roteador} />
    </QueryClientProvider>,
  );
}

describe("sino de notificações (RF-SHELL-002)", () => {
  it("é um ícone neutro, sem contador, quando não há notificações não lidas", async () => {
    await abrir();
    const sino = await screen.findByRole("button", { name: "Notificações" });
    expect(sino).toHaveTextContent("");
  });

  it("mostra o contador de não lidas", async () => {
    notificacoes = [
      notificacao({ id: "a" }),
      notificacao({ id: "b" }),
      notificacao({ id: "c", lida: true }),
    ];
    await abrir();
    const sino = await screen.findByRole("button", { name: "Notificações: 2 não lidas" });
    expect(sino).toHaveTextContent("2");
  });

  it("marca como lida e abre o link ao escolher uma notificação", async () => {
    notificacoes = [notificacao({ id: "a" })];
    await abrir();
    await userEvent.click(await screen.findByRole("button", { name: /Notificações: 1 não lida/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /1 novo alerta ambiental/ }));
    await waitFor(() => expect(chamadas).toEqual(["ler:a"]));
    expect(await screen.findByRole("heading", { name: "Integrações" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notificações" })).toBeInTheDocument(),
    );
  });

  it("não chama a API de leitura para notificação já lida", async () => {
    notificacoes = [
      notificacao({ id: "a", titulo: "Aviso antigo", lida: true }),
      notificacao({ id: "b", titulo: "Aviso novo" }),
    ];
    await abrir();
    await userEvent.click(await screen.findByRole("button", { name: /Notificações/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Aviso antigo/ }));
    expect(await screen.findByRole("heading", { name: "Integrações" })).toBeInTheDocument();
    expect(chamadas).toEqual([]);
  });

  it("marca todas como lidas", async () => {
    notificacoes = [notificacao({ id: "a" }), notificacao({ id: "b" })];
    await abrir();
    await userEvent.click(await screen.findByRole("button", { name: /Notificações: 2 não lidas/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Marcar todas como lidas" }));
    await waitFor(() => expect(chamadas).toEqual(["ler-todas"]));
    // O menu continua aberto (o resto da página fica oculto para leitores de tela).
    expect(
      await screen.findByRole("button", { name: "Notificações", hidden: true }),
    ).toBeInTheDocument();
  });

  it("informa quando não há nada novo", async () => {
    await abrir();
    await userEvent.click(await screen.findByRole("button", { name: "Notificações" }));
    expect(await screen.findByText("Nada novo por aqui.")).toBeInTheDocument();
  });
});
