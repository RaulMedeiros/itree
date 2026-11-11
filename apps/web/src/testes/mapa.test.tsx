import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { mapasCriados } from "./mapaFalso";

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

const BAIRRO = {
  type: "Feature",
  id: "b-1",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-38.56, -3.76],
        [-38.55, -3.76],
        [-38.55, -3.75],
        [-38.56, -3.75],
        [-38.56, -3.76],
      ],
    ],
  },
  properties: { nome: "Meireles", tipo: "bairro" },
};

const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/mapa/camadas`, () =>
    HttpResponse.json({
      territorios: [],
      arvores: { total: 3, sem_localizacao: 0, atualizado_em: null },
      ocorrencias: null,
      limites_escopo: null,
    }),
  ),
  http.get(`${API}/api/v1/territorios/geojson`, () =>
    HttpResponse.json({ type: "FeatureCollection", features: [BAIRRO] }),
  ),
  http.get(`${API}/api/v1/mapa/busca`, ({ request }) => {
    const q = new URL(request.url).searchParams.get("q");
    return HttpResponse.json(
      q === "mei"
        ? [
            {
              tipo: "territorio",
              id: "b-1",
              rotulo: "Meireles",
              descricao: "Bairro",
              localizacao: null,
              limites: [-38.56, -3.76, -38.55, -3.75],
            },
          ]
        : [
            {
              tipo: "coordenada",
              id: null,
              rotulo: "-3.700000, -38.500000",
              descricao: "Coordenada",
              localizacao: { longitude: -38.5, latitude: -3.7 },
              limites: null,
            },
          ],
    );
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
beforeEach(() => void (mapasCriados.length = 0));
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
  return vi.waitFor(() => {
    expect(mapasCriados).toHaveLength(1);
    return mapasCriados[0]!;
  });
}

const feicoesRealcadas = (m: (typeof mapasCriados)[number]) => m.dadosDe("destaque").features;

async function buscarBairro(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.type(screen.getByRole("combobox", { name: "Busca global" }), "mei");
  await usuario.click(await screen.findByRole("option", { name: /Meireles/ }));
}

describe("realce do bairro buscado (RF-MAPA-011)", () => {
  it("destaca o polígono ao escolher o bairro na busca, abaixo do anel da seleção", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    expect(feicoesRealcadas(mapa)).toEqual([]);

    await buscarBairro(usuario);

    expect(await screen.findByText("Bairro em destaque:")).toBeInTheDocument();
    expect(feicoesRealcadas(mapa)).toHaveLength(1);
    expect(feicoesRealcadas(mapa)[0]!.properties.nome).toBe("Meireles");
    expect(mapa.fitBounds).toHaveBeenCalledWith([-38.56, -3.76, -38.55, -3.75], expect.anything());
    // Realce translúcido, acima das árvores e abaixo do anel de seleção.
    const ids = mapa.camadas.map((c) => c.id);
    expect(ids.indexOf("destaque-preenchimento")).toBeGreaterThan(-1);
    expect(mapa.camadas.find((c) => c.id === "destaque-contorno")?.antesDe).toBe("selecao");
  });

  it("remove o realce no próximo clique no mapa", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    await buscarBairro(usuario);
    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toHaveLength(1));

    act(() => mapa.emitir("click"));

    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toEqual([]));
    expect(screen.queryByText("Bairro em destaque:")).not.toBeInTheDocument();
  });

  it("remove o realce ao limpar e em uma nova busca", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    await buscarBairro(usuario);
    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toHaveLength(1));

    await usuario.click(screen.getByRole("button", { name: "Limpar destaque do bairro" }));
    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toEqual([]));

    await buscarBairro(usuario);
    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toHaveLength(1));
    await usuario.type(screen.getByRole("combobox", { name: "Busca global" }), "-3.7, -38.5");
    await usuario.click(await screen.findByRole("option", { name: /Coordenada/ }));
    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toEqual([]));
  });
});
