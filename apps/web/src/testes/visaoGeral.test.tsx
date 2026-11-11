import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
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
vi.mock("maplibre-gl", () => ({ setWorkerUrl: () => undefined }));
vi.mock("../paginas/visao-geral/MapaResumo", () => ({ MapaResumo: () => null }));

const API = "http://api.teste";

const GESTOR: Eu = {
  id: "u-g",
  nome: "Gil Gestor",
  email: "gil@itree.teste",
  papeis: ["gestor"],
  permissoes: ["mapa.ler", "inventario.ler", "relatorios.ler"],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

function indicador(extra: Record<string, unknown>) {
  return {
    definicao: "d",
    formula: "f",
    base: null,
    unidade: "",
    periodo: "instantâneo",
    fonte: "Registros da plataforma",
    link: null,
    anterior: null,
    anterior_em: null,
    serie: [],
    ...extra,
  };
}

function painel(extra: Record<string, unknown> = {}) {
  return {
    periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
    filtros: { bairro: null, equipe: null },
    calculado_em: "2026-10-31T12:00:00Z",
    indicadores: [],
    distribuicoes: {},
    series_mensais: { meses: [], definicao: "", series: [] },
    pendencias: [],
    bairros_atencao: { titulo: "Bairros que pedem atenção", definicao: "", formula: "", itens: [] },
    equipes: [],
    atividades: [],
    ...extra,
  };
}

const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/territorios`, () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => servidor.resetHandlers());
afterAll(() => servidor.close());

async function abrirComPainel(corpo: unknown) {
  servidor.use(http.get(`${API}/api/v1/indicadores/painel`, () => HttpResponse.json(corpo)));
  const { criarRoteador } = await import("../rotas");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider
        router={criarRoteador(createMemoryHistory({ initialEntries: ["/visao-geral"] }))}
      />
    </QueryClientProvider>,
  );
}

const cartaoDe = async (nome: string) =>
  (await screen.findByText(nome)).closest(".rounded-xl") as HTMLElement;

describe("visão geral: comparação sobre base pequena (R2-22)", () => {
  it("mostra a diferença absoluta, não o percentual, quando o período anterior é menor que 20", async () => {
    await abrirComPainel(
      painel({
        indicadores: [
          indicador({
            id: "inspecoes_realizadas",
            nome: "Inspeções realizadas",
            valor: 7,
            periodo: "selecionado",
            anterior: 2,
            anterior_em: "2026-09-11",
          }),
        ],
      }),
    );
    const cartao = await cartaoDe("Inspeções realizadas");
    expect(within(cartao).getByText(/^\+5 vs\. 11\/09\/26/)).toBeInTheDocument();
    expect(within(cartao).queryByText(/250%/)).toBeNull();
  });

  it("mantém o percentual quando a base anterior é grande", async () => {
    await abrirComPainel(
      painel({
        indicadores: [
          indicador({
            id: "inspecoes_realizadas",
            nome: "Inspeções realizadas",
            valor: 30,
            periodo: "selecionado",
            anterior: 20,
            anterior_em: "2026-09-11",
          }),
        ],
      }),
    );
    const cartao = await cartaoDe("Inspeções realizadas");
    expect(within(cartao).getByText(/^\+50% vs\. 11\/09\/26/)).toBeInTheDocument();
  });
});
