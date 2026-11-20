import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CamadaBase } from "../config";
import { baseEfetiva, lembrarBase, lerBaseLembrada } from "../mapa/baseLembrada";
import { criarServidor } from "./servidorPadrao";

const estado = vi.hoisted(() => ({ satelite: null as CamadaBase | null }));

vi.mock("../config", async (original) => {
  const real = await original<typeof import("../config")>();
  const config = { ...real.config };
  Object.defineProperty(config, "mapaSatelite", { get: () => estado.satelite, enumerable: true });
  return { ...real, config };
});
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

const SATELITE: CamadaBase = {
  url: "https://tiles.exemplo.teste/{z}/{y}/{x}.jpg",
  nome: "Sentinel-2 cloudless 2016 (EOX)",
  atribuicao: "Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH",
  zoomMaximo: 14,
  data: "2016-12-31",
  aviso: "imagem de 10 m: mostra manchas de vegetação, não árvores individuais",
};

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/mapa/camadas`, () =>
    HttpResponse.json({
      territorios: [],
      areas_verdes: [],
      iluminacao: null,
      arvores: { total: 0, sem_localizacao: 0, atualizado_em: null },
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
  estado.satelite = SATELITE;
  localStorage.clear();
});
afterEach(() => {
  servidor.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => servidor.close());

async function abrirMapa(rota = "/mapa") {
  const { criarRoteador } = await import("../rotas");
  const historia = createMemoryHistory({ initialEntries: [rota] });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={criarRoteador(historia)} />
    </QueryClientProvider>,
  );
  const regiao = await screen.findByRole(
    "region",
    { name: "Mapa de árvores e ocorrências" },
    { timeout: 3000 },
  );
  return { regiao, historia };
}

describe("seletor de mapa base", () => {
  it("some quando não há provedor de satélite configurado", async () => {
    estado.satelite = null;
    const { regiao } = await abrirMapa();
    expect(regiao).toHaveAttribute("data-base", "ruas");
    expect(screen.queryByRole("group", { name: "Mapa base" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Satélite/ })).not.toBeInTheDocument();
  });

  it("sem satélite configurado, ignora base=satelite da URL e da preferência", async () => {
    estado.satelite = null;
    lembrarBase(GESTOR.id, "satelite");
    const { regiao } = await abrirMapa("/mapa?base=satelite");
    expect(regiao).toHaveAttribute("data-base", "ruas");
  });

  it("com satélite configurado, oferece Mapa e Satélite e avisa a resolução", async () => {
    const { regiao } = await abrirMapa();
    const grupo = await screen.findByRole("group", { name: "Mapa base" });
    expect(within(grupo).getByRole("button", { name: "Mapa", pressed: true })).toBeVisible();
    expect(within(grupo).getByRole("button", { name: "Satélite", pressed: false })).toBeVisible();
    // O aviso fica no próprio seletor, ao lado das opções.
    expect(
      within(grupo).getByText(
        /imagem de 10 m: mostra manchas de vegetação, não árvores individuais/,
      ),
    ).toBeVisible();
    expect(regiao).toHaveAttribute("data-base", "ruas");
  });

  it("ao escolher Satélite, põe base=satelite na URL, lembra a escolha e mostra a atribuição", async () => {
    const usuario = userEvent.setup();
    const { regiao, historia } = await abrirMapa();
    await usuario.click(await screen.findByRole("button", { name: "Satélite" }));
    await vi.waitFor(() => expect(historia.location.search).toContain("base=satelite"));
    expect(regiao).toHaveAttribute("data-base", "satelite");
    expect(screen.getByRole("button", { name: "Satélite", pressed: true })).toBeVisible();
    expect(lerBaseLembrada(GESTOR.id)).toBe("satelite");
    expect(
      screen.getByText(/imagem de 31\/12\/2016 · Sentinel-2 cloudless – .*EOX IT Services/),
    ).toBeInTheDocument();
  });

  it("volta a Mapa e a URL registra base=ruas, que vale mais que a preferência lembrada", async () => {
    const usuario = userEvent.setup();
    lembrarBase(GESTOR.id, "satelite");
    const { regiao, historia } = await abrirMapa("/mapa?base=satelite");
    await usuario.click(await screen.findByRole("button", { name: "Mapa" }));
    await vi.waitFor(() => expect(historia.location.search).toContain("base=ruas"));
    expect(regiao).toHaveAttribute("data-base", "ruas");
    expect(lerBaseLembrada(GESTOR.id)).toBe("ruas");
  });

  it("lembra a escolha: sem base na URL, abre no satélite e a URL passa a refletir", async () => {
    lembrarBase(GESTOR.id, "satelite");
    const { regiao, historia } = await abrirMapa();
    expect(regiao).toHaveAttribute("data-base", "satelite");
    await vi.waitFor(() => expect(historia.location.search).toContain("base=satelite"));
  });

  it("a preferência é de cada pessoa", async () => {
    lembrarBase("outra-pessoa", "satelite");
    const { regiao } = await abrirMapa();
    expect(regiao).toHaveAttribute("data-base", "ruas");
  });

  it("não quebra sem localStorage (janela privada)", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const usuario = userEvent.setup();
    const { regiao, historia } = await abrirMapa();
    await usuario.click(await screen.findByRole("button", { name: "Satélite" }));
    await vi.waitFor(() => expect(historia.location.search).toContain("base=satelite"));
    expect(regiao).toHaveAttribute("data-base", "satelite");
  });
});

describe("base efetiva", () => {
  it("prefere a URL, depois a lembrada, e nunca satélite sem provedor", () => {
    expect(baseEfetiva("ruas", "satelite", true)).toBe("ruas");
    expect(baseEfetiva(undefined, "satelite", true)).toBe("satelite");
    expect(baseEfetiva(undefined, null, true)).toBe("ruas");
    expect(baseEfetiva("satelite", null, false)).toBe("ruas");
  });

  it("ignora valor inválido guardado", () => {
    localStorage.setItem("itree:mapa-base:u", "hibrido");
    expect(lerBaseLembrada("u")).toBeNull();
  });
});
