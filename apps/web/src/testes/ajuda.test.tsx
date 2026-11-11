import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GLOSSARIO, TERMOS } from "../ajuda/glossario";
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

const ADMIN: Eu = {
  id: "u-admin",
  nome: "Ana Admin",
  email: "ana@itree.teste",
  papeis: ["administrador"],
  permissoes: ["inventario.ler", "mapa.ler"],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};
const GESTOR: Eu = { ...ADMIN, papeis: ["gestor"] };

let eu: Eu = ADMIN;
const vazio = { count: 0, next: null, previous: null, results: [] };

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/arvores`, () => HttpResponse.json(vazio)),
  http.get(`${API}/api/v1/arvores/contadores`, () =>
    HttpResponse.json({ total: 10, validos: 8, limite_tarefas_em_lote: 500 }),
  ),
  http.get(`${API}/api/v1/especies`, () => HttpResponse.json(vazio)),
  http.get(`${API}/api/v1/territorios`, () => HttpResponse.json(vazio)),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  eu = ADMIN;
});
afterAll(() => servidor.close());

async function abrir(caminho: string) {
  const { criarRoteador } = await import("../rotas");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={criarRoteador(createMemoryHistory({ initialEntries: [caminho] }))} />
    </QueryClientProvider>,
  );
}

describe("glossário (G-06)", () => {
  it("define os termos do domínio pedidos", () => {
    expect(GLOSSARIO.map((t) => t.termo)).toEqual(
      expect.arrayContaining([
        "Registro válido",
        "Condição aparente",
        "Origem da localização",
        "Risco confirmado",
        "Escopo territorial",
        "Sugestão de IA",
        "Fonte externa",
      ]),
    );
    expect(GLOSSARIO.length).toBeGreaterThanOrEqual(7);
  });

  it("não deixa códigos internos no texto do usuário final (R2-14)", () => {
    for (const t of GLOSSARIO) {
      for (const texto of [t.termo, t.definicao, ...(t.detalhes ?? [])]) {
        expect(texto).not.toMatch(/\b(DP|RN|RF|CA)-[A-Z0-9-]+/);
      }
      expect(t.regras.length).toBeGreaterThan(0);
    }
    expect(Object.keys(TERMOS)).toHaveLength(GLOSSARIO.length);
  });

  it("explica as três origens de localização", () => {
    const d = TERMOS.origem_localizacao.definicao;
    expect(d).toMatch(/GPS de campo/);
    expect(d).toMatch(/Importada/);
    expect(d).toMatch(/Estimada/);
  });
});

describe("página Ajuda", () => {
  it("fica na barra lateral e lista todos os termos", async () => {
    await abrir("/ajuda");
    expect(await screen.findByRole("heading", { name: "Ajuda", level: 1 })).toBeInTheDocument();
    const lateral = screen.getByRole("navigation", { name: "Ajuda" });
    expect(within(lateral).getByRole("link", { name: "Ajuda" })).toHaveAttribute("href", "/ajuda");
    for (const t of GLOSSARIO) {
      expect(screen.getByRole("heading", { name: t.termo, level: 2 })).toBeInTheDocument();
    }
  });

  it("mostra as regras de origem só para administradores, em detalhes técnicos", async () => {
    await abrir("/ajuda");
    await screen.findByRole("heading", { name: "Registro válido" });
    expect(screen.getAllByText("Detalhes técnicos").length).toBe(GLOSSARIO.length);
    expect(screen.getAllByText(/Regras de origem: RN-INV-001, DP-14/).length).toBe(1);
  });

  it("não mostra códigos para quem não administra", async () => {
    eu = GESTOR;
    await abrir("/ajuda");
    await screen.findByRole("heading", { name: "Registro válido" });
    expect(screen.queryByText("Detalhes técnicos")).toBeNull();
    expect(screen.queryByText(/RN-INV-001/)).toBeNull();
  });
});

describe("ícone ? ao lado dos termos", () => {
  it("abre a definição de registro válido na lista de árvores", async () => {
    eu = GESTOR;
    await abrir("/inventario/arvores");
    await userEvent.click(await screen.findByRole("button", { name: "O que é registro válido?" }));
    const dialogo = await screen.findByRole("dialog", { name: "Registro válido" });
    expect(within(dialogo).getByText(/localização de origem conhecida/)).toBeInTheDocument();
    expect(within(dialogo).queryByText(/RN-INV-001|DP-14/)).toBeNull();
    expect(within(dialogo).getByRole("link", { name: "Ver o glossário completo" })).toHaveAttribute(
      "href",
      "/ajuda#registro_valido",
    );
  });

  it("administrador vê o código só em detalhes técnicos", async () => {
    await abrir("/inventario/arvores");
    await userEvent.click(await screen.findByRole("button", { name: "O que é registro válido?" }));
    const dialogo = await screen.findByRole("dialog", { name: "Registro válido" });
    expect(within(dialogo).getByText("Detalhes técnicos")).toBeInTheDocument();
    expect(within(dialogo).getByText(/RN-INV-001, DP-14/)).toBeInTheDocument();
  });

  it("explica o escopo territorial no cabeçalho", async () => {
    eu = GESTOR;
    await abrir("/ajuda");
    await userEvent.click(
      await screen.findByRole("button", { name: "O que é escopo territorial?" }),
    );
    const dialogo = await screen.findByRole("dialog", { name: "Escopo territorial" });
    expect(
      within(dialogo).getByText(/Dados fora dele não aparecem em listas, mapas/),
    ).toBeVisible();
  });
});
