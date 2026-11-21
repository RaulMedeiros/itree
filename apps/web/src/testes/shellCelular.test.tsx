import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { simularCelular } from "./celular";
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
  permissoes: ["alertas.ler", "admin.configuracao", "inventario.ler", "ocorrencias.ler"],
  territorios: [{ id: "t-for", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "demonstracao",
};

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(USUARIO)),
  http.get(`${API}/api/v1/alertas/ingestoes`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/alertas/fontes`, () => HttpResponse.json([])),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "token-teste" });
});
afterEach(() => servidor.resetHandlers());
afterAll(() => servidor.close());

async function abrir(caminho: string) {
  const { criarRoteador } = await import("../rotas");
  const roteador = criarRoteador(createMemoryHistory({ initialEntries: [caminho] }));
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <RouterProvider router={roteador} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Abrir menu" });
  return roteador;
}

describe("menu em gaveta (celular)", () => {
  it("o botão de menu abre a gaveta com a navegação e a ajuda", async () => {
    await abrir("/administracao/integracoes");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Abrir menu" }));
    const gaveta = await screen.findByRole("dialog", { name: "Menu de navegação" });
    expect(within(gaveta).getByRole("link", { name: /Ocorrências/ })).toBeInTheDocument();
    expect(within(gaveta).getByRole("link", { name: "Ajuda" })).toBeInTheDocument();
  });

  it("fecha com Esc e devolve o foco ao botão de menu", async () => {
    await abrir("/administracao/integracoes");
    const botao = screen.getByRole("button", { name: "Abrir menu" });
    await userEvent.click(botao);
    await screen.findByRole("dialog", { name: "Menu de navegação" });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(botao).toHaveFocus();
  });

  it("prende o foco dentro da gaveta enquanto ela está aberta", async () => {
    await abrir("/administracao/integracoes");
    await userEvent.click(screen.getByRole("button", { name: "Abrir menu" }));
    const gaveta = await screen.findByRole("dialog", { name: "Menu de navegação" });
    for (let n = 0; n < 40; n++) {
      await userEvent.tab();
      expect(gaveta).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("fecha ao escolher um módulo e a página nova abre", async () => {
    const roteador = await abrir("/administracao/integracoes");
    await userEvent.click(screen.getByRole("button", { name: "Abrir menu" }));
    const gaveta = await screen.findByRole("dialog", { name: "Menu de navegação" });
    await userEvent.click(within(gaveta).getByRole("link", { name: /Ocorrências/ }));
    expect(roteador.state.location.pathname).toBe("/ocorrencias");
    expect(screen.queryByRole("dialog", { name: "Menu de navegação" })).not.toBeInTheDocument();
  });

  it("fecha também quando a rota muda por outro caminho (voltar, link da página)", async () => {
    const roteador = await abrir("/administracao/integracoes");
    await userEvent.click(screen.getByRole("button", { name: "Abrir menu" }));
    await screen.findByRole("dialog", { name: "Menu de navegação" });
    await act(() => roteador.navigate({ to: "/ocorrencias" }));
    expect(screen.queryByRole("dialog", { name: "Menu de navegação" })).not.toBeInTheDocument();
  });

  it("a faixa de demonstração continua visível com o menu fechado", async () => {
    simularCelular();
    await abrir("/administracao/integracoes");
    expect(screen.getByText(/Dados de demonstração/)).toBeInTheDocument();
  });
});

describe("cabeçalho compacto (celular)", () => {
  it("troca o campo de busca por um ícone que abre a busca em tela cheia", async () => {
    simularCelular();
    await abrir("/administracao/integracoes");
    expect(screen.queryByRole("combobox", { name: "Busca global" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Abrir busca" }));
    const busca = await screen.findByRole("combobox", { name: "Busca global" });
    expect(screen.getByRole("dialog", { name: "Busca" })).toContainElement(busca);
    expect(busca).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: "Busca global" })).not.toBeInTheDocument();
  });

  it("no desktop mantém o campo de busca no cabeçalho, sem o ícone", async () => {
    await abrir("/administracao/integracoes");
    expect(screen.getByRole("combobox", { name: "Busca global" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir busca" })).not.toBeInTheDocument();
  });

  it("o seletor de território e as notificações seguem acessíveis", async () => {
    simularCelular();
    await abrir("/administracao/integracoes");
    expect(screen.getByText("Fortaleza")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Notificações/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Conta de Ana Admin/ })).toBeInTheDocument();
  });
});
