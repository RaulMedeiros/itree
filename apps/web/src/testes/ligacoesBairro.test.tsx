import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("maplibre-gl", () => ({ setWorkerUrl: () => undefined, Marker: vi.fn() }));
vi.mock("../mapa/Mapa", async () => ({
  Mapa: (await import("./MapaFalsoComponente")).MapaFalsoComponente,
}));
vi.mock("../mapa/simbologia", async (original) => ({
  ...(await original<typeof import("../mapa/simbologia")>()),
  registrarIcones: vi.fn(),
  aoFaltarImagem: vi.fn(),
}));
vi.mock("../paginas/visao-geral/MapaResumo", () => ({ MapaResumo: () => null }));

const API = "http://api.teste";
const ID = "b-meireles";

const GESTOR: Eu = {
  id: "u-g",
  nome: "Gil Gestor",
  email: "gil@itree.teste",
  papeis: ["gestor"],
  permissoes: ["mapa.ler", "inventario.ler", "relatorios.ler"],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const BAIRRO = {
  type: "Feature",
  id: ID,
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

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/territorios`, () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
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
    HttpResponse.json({ type: "FeatureCollection", features: [BAIRRO] }),
  ),
  http.get(`${API}/api/v1/areas-verdes`, () =>
    HttpResponse.json({ type: "FeatureCollection", features: [] }),
  ),
  http.get(`${API}/api/v1/mapa/busca`, () =>
    HttpResponse.json([
      {
        tipo: "territorio",
        id: ID,
        rotulo: "Meireles",
        descricao: "Bairro",
        subtipo: "bairro",
        localizacao: null,
        limites: [-38.56, -3.76, -38.55, -3.75],
      },
      {
        tipo: "territorio",
        id: "r-2",
        rotulo: "SER 2",
        descricao: "Regional",
        subtipo: "regional",
        localizacao: null,
        limites: [-38.6, -3.8, -38.5, -3.7],
      },
    ]),
  ),
  http.get(`${API}/api/v1/relatorios/catalogo`, () =>
    HttpResponse.json({
      analises: [{ id: "arvores_por_bairro", titulo: "Árvores por bairro", definicao: "d" }],
    }),
  ),
  http.get(`${API}/api/v1/relatorios/analise`, () =>
    HttpResponse.json({
      id: "arvores_por_bairro",
      titulo: "Árvores por bairro",
      definicao: "d",
      fonte: "Registros da plataforma",
      periodo: { inicio: "2025-11-10", fim: "2026-11-10" },
      calculado_em: "2026-11-10T12:00:00Z",
      por_bairro: true,
      unidade: "",
      base_rotulo: "",
      linhas: [
        { rotulo: "Meireles", valor: 88, territorio_id: ID },
        { rotulo: "Fora dos bairros cadastrados", valor: 3, territorio_id: null },
        { rotulo: "Cocó", valor: 0, territorio_id: "b-coco" },
      ],
      total: 91,
    }),
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

async function abrir(caminho: string) {
  const { criarRoteador } = await import("../rotas");
  const roteador = criarRoteador(createMemoryHistory({ initialEntries: [caminho] }));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={roteador} />
    </QueryClientProvider>,
  );
  return roteador;
}

describe("o nome do bairro leva à ficha", () => {
  it("na busca global, o resultado Bairro abre a ficha; a regional segue para o mapa", async () => {
    const usuario = userEvent.setup();
    const roteador = await abrir("/analises");
    const busca = await screen.findByRole("combobox", { name: "Busca global" });
    await usuario.type(busca, "mei");
    const opcoes = within(await screen.findByRole("listbox")).getAllByRole("option");
    // O rótulo do tipo diz "Bairro" (e não "Território") para o bairro.
    expect(within(opcoes[0]!).getAllByText("Bairro")).toHaveLength(2); // tipo e descrição
    expect(within(opcoes[1]!).getByText("Território")).toBeVisible();
    await usuario.click(opcoes[0]!);
    await vi.waitFor(() => expect(roteador.state.location.pathname).toBe(`/bairros/${ID}`));
  });

  it("no mapa, a busca pelo bairro continua no mapa (destaque, M-05)", async () => {
    const usuario = userEvent.setup();
    const roteador = await abrir("/mapa");
    await usuario.type(await screen.findByRole("combobox", { name: "Busca global" }), "mei");
    await usuario.click(within(await screen.findByRole("listbox")).getAllByRole("option")[0]!);
    await vi.waitFor(() => expect(roteador.state.location.pathname).toBe("/mapa"));
  });

  it("na busca global, uma regional continua abrindo o mapa enquadrado", async () => {
    const usuario = userEvent.setup();
    const roteador = await abrir("/analises");
    await usuario.type(await screen.findByRole("combobox", { name: "Busca global" }), "ser");
    await usuario.click(within(await screen.findByRole("listbox")).getAllByRole("option")[1]!);
    await vi.waitFor(() => expect(roteador.state.location.pathname).toBe("/mapa"));
  });

  it("nas análises por bairro, só a linha de um bairro é link; “sem bairro” não é", async () => {
    await abrir("/analises");
    const link = await screen.findByRole("link", { name: "Meireles" });
    expect(link).toHaveAttribute("href", `/bairros/${ID}`);
    expect(screen.getByText("Fora dos bairros cadastrados")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Fora dos bairros cadastrados" })).toBeNull();
    // Também no grupo recolhido dos bairros sem valor.
    expect(screen.getByRole("link", { name: "Cocó" })).toHaveAttribute("href", "/bairros/b-coco");
  });

  it("no mapa, o bairro em destaque tem link para a ficha", async () => {
    await abrir(`/mapa?destaque=${ID}`);
    const link = await screen.findByRole("link", { name: "Meireles: abrir a ficha do bairro" });
    expect(link).toHaveAttribute("href", `/bairros/${ID}`);
  });
});
