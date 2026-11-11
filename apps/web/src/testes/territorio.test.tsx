import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { criarServidor } from "./servidorPadrao";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { territorioAtivoValido } from "../layout/territorio";

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

const FORTALEZA = { id: "t-for", nome: "Fortaleza", tipo: "municipio" } as const;
const ALDEOTA = { id: "t-ald", nome: "Aldeota", tipo: "bairro" } as const;
const MEIRELES = { id: "t-mei", nome: "Meireles", tipo: "bairro" } as const;

const USUARIO: Eu = {
  id: "u-1",
  nome: "Ana Gestora",
  email: "ana@itree.teste",
  papeis: ["gestor"],
  permissoes: ["inspecoes.ler"],
  territorios: [ALDEOTA, MEIRELES],
  ambiente: "producao",
};

let eu: Eu = USUARIO;
const bairrosPedidos: (string | null)[] = [];

const pagina = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/notificacoes/contagem`, () => HttpResponse.json({ nao_lidas: 0 })),
  http.get(`${API}/api/v1/alertas/ingestoes`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/territorios`, () => HttpResponse.json(pagina([ALDEOTA, MEIRELES]))),
  http.get(`${API}/api/v1/inspecoes`, ({ request }) => {
    bairrosPedidos.push(new URL(request.url).searchParams.get("bairro"));
    return HttpResponse.json(pagina([]));
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "token-teste" });
});
afterEach(() => {
  servidor.resetHandlers();
  eu = USUARIO;
  bairrosPedidos.length = 0;
  localStorage.clear();
});
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
  return roteador;
}

describe("território ativo (valida o que estava salvo)", () => {
  it("só vale um bairro que continua no escopo", () => {
    expect(territorioAtivoValido([ALDEOTA, MEIRELES], "t-mei")).toBe("t-mei");
    expect(territorioAtivoValido([ALDEOTA, MEIRELES], "t-outro")).toBeUndefined();
    expect(territorioAtivoValido([ALDEOTA, MEIRELES], null)).toBeUndefined();
  });

  it("o município significa todo o escopo, e um território só não tem filtro", () => {
    expect(territorioAtivoValido([FORTALEZA, ALDEOTA], "t-for")).toBeUndefined();
    expect(territorioAtivoValido([ALDEOTA], "t-ald")).toBeUndefined();
  });
});

describe("seletor de território no cabeçalho", () => {
  it("com um território só, mostra o nome e nenhum seletor", async () => {
    eu = { ...USUARIO, territorios: [FORTALEZA] };
    await abrir("/inspecoes");
    expect(await screen.findByText("Fortaleza")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Território" })).not.toBeInTheDocument();
  });

  it("com mais de um, filtra a lista pelo território escolhido e lembra a escolha", async () => {
    await abrir("/inspecoes");
    const seletor = await screen.findByRole("combobox", { name: "Território" });
    await waitFor(() => expect(bairrosPedidos.length).toBeGreaterThan(0));
    expect(bairrosPedidos.at(-1)).toBeNull();
    expect(
      within(seletor).getByRole("option", { name: "Todos os meus territórios" }),
    ).toBeInTheDocument();

    await userEvent.selectOptions(seletor, "t-mei");
    await waitFor(() => expect(bairrosPedidos.at(-1)).toBe("t-mei"));
    expect(localStorage.getItem("itree:territorio-ativo:u-1")).toBe("t-mei");
  });

  it("aplica a escolha guardada ao abrir outra tela e volta a todo o escopo ao limpar", async () => {
    localStorage.setItem("itree:territorio-ativo:u-1", "t-ald");
    await abrir("/inspecoes");
    const seletor = await screen.findByRole("combobox", { name: "Território" });
    await waitFor(() => expect(bairrosPedidos.at(-1)).toBe("t-ald"));
    expect(seletor).toHaveValue("t-ald");

    await userEvent.selectOptions(seletor, "");
    await waitFor(() => expect(bairrosPedidos.at(-1)).toBeNull());
    expect(localStorage.getItem("itree:territorio-ativo:u-1")).toBeNull();
  });

  it("o bairro da URL vale mais e a escolha do cabeçalho o substitui", async () => {
    localStorage.setItem("itree:territorio-ativo:u-1", "t-ald");
    const roteador = await abrir("/inspecoes?bairro=t-mei");
    await screen.findByRole("combobox", { name: "Território" });
    await waitFor(() => expect(bairrosPedidos.at(-1)).toBe("t-mei"));

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Território" }), "t-ald");
    await waitFor(() => expect(bairrosPedidos.at(-1)).toBe("t-ald"));
    expect(roteador.state.location.search).toMatchObject({ bairro: "t-ald" });
  });
});
