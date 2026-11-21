import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PainelDetalhe } from "../mapa/PainelDetalhe";
import { simularCelular } from "./celular";
import { mapasCriados } from "./mapaFalso";
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
// O MapLibre precisa de WebGL, ausente no jsdom: a tela usa um mapa falso.
vi.mock("maplibre-gl", () => ({ setWorkerUrl: () => undefined, Marker: vi.fn() }));
vi.mock("../mapa/Mapa", async () => ({
  Mapa: (await import("./MapaFalsoComponente")).MapaFalsoComponente,
}));
vi.mock("../mapa/simbologia", async (original) => ({
  ...(await original<typeof import("../mapa/simbologia")>()),
  registrarIcones: vi.fn(),
  aoFaltarImagem: vi.fn(),
}));

const API = "http://api.teste";

const GESTOR: Eu = {
  id: "u-g",
  nome: "Gil Gestor",
  email: "gil@itree.teste",
  papeis: ["gestor"],
  permissoes: ["mapa.ler", "inventario.ler"],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/mapa/camadas`, () =>
    HttpResponse.json({
      territorios: [],
      areas_verdes: [],
      iluminacao: null,
      arvores: { total: 3, sem_localizacao: 0, atualizado_em: null },
      ocorrencias: null,
      limites_escopo: null,
    }),
  ),
  http.get(`${API}/api/v1/territorios/geojson`, () =>
    HttpResponse.json({ type: "FeatureCollection", features: [] }),
  ),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
beforeEach(() => {
  mapasCriados.length = 0;
});
afterEach(() => servidor.resetHandlers());
afterAll(() => servidor.close());

async function abrirMapa() {
  const { criarRoteador } = await import("../rotas");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={criarRoteador(createMemoryHistory({ initialEntries: ["/mapa"] }))} />
    </QueryClientProvider>,
  );
  await screen.findByRole("region", { name: "Mapa de árvores e ocorrências" }, { timeout: 3000 });
}

describe("folha de camadas no celular", () => {
  it("começa recolhida: só o botão, sem o painel", async () => {
    simularCelular();
    await abrirMapa();
    expect(await screen.findByRole("button", { name: "Camadas e filtros" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Camadas e filtros" })).toBeNull();
  });

  it("abre ao tocar no botão e recolhe pela alça", async () => {
    simularCelular();
    await abrirMapa();
    await userEvent.click(await screen.findByRole("button", { name: "Camadas e filtros" }));
    expect(screen.getByRole("complementary", { name: "Camadas e filtros" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Recolher camadas e filtros" }));
    expect(screen.queryByRole("complementary", { name: "Camadas e filtros" })).toBeNull();
    expect(screen.getByRole("button", { name: "Camadas e filtros" })).toBeInTheDocument();
  });

  it("a legenda começa recolhida, para não cobrir o mapa", async () => {
    simularCelular();
    await abrirMapa();
    const legenda = await screen.findByRole("region", { name: "Legenda" });
    expect(legenda.querySelector("button[aria-expanded]")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("no desktop o painel continua aberto por padrão", async () => {
    await abrirMapa();
    expect(
      await screen.findByRole("complementary", { name: "Camadas e filtros" }),
    ).toBeInTheDocument();
  });
});

describe("painel de detalhe como folha inferior", () => {
  it("abre em meia altura e a alça expande e recolhe", async () => {
    render(<PainelDetalhe rotulo="Detalhes da seleção">conteúdo</PainelDetalhe>);
    const painel = screen.getByRole("complementary", { name: "Detalhes da seleção" });
    expect(painel).toHaveClass("max-md:max-h-[48%]");
    await userEvent.click(screen.getByRole("button", { name: "Expandir detalhes" }));
    expect(painel).toHaveClass("max-md:max-h-[92%]");
    const alca = screen.getByRole("button", { name: "Recolher detalhes" });
    expect(alca).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(alca);
    expect(painel).toHaveClass("max-md:max-h-[48%]");
  });
});
