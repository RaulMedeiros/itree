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

async function abrirComPainel(corpo: object) {
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

describe("visão geral: árvores sem espécie confirmada (R2-09)", () => {
  it("o link leva à lista de árvores filtrada por espécie não confirmada", async () => {
    await abrirComPainel(
      painel({
        distribuicoes: {
          especies: {
            titulo: "Espécies confirmadas (10 mais frequentes)",
            definicao: "d",
            nao_confirmadas: 165,
            itens: [{ rotulo: "Licania tomentosa", quantidade: 3 }],
          },
        },
      }),
    );
    const link = await screen.findByRole("link", { name: "Ver 165 árvores" });
    const destino = new URL(link.getAttribute("href")!, "http://x");
    expect(destino.pathname).toBe("/inventario/arvores");
    expect(destino.searchParams.get("especie_estado")).toBe("nao_confirmada");
    expect(destino.searchParams.get("valida")).toBe("true");
    expect(screen.queryByRole("link", { name: "Ver catálogo" })).toBeNull();
  });
});

describe("visão geral: cartões enxutos e sem repetição (R2-02, R2-03)", () => {
  const dados = painel({
    indicadores: [
      indicador({
        id: "arvores_registros",
        nome: "Árvores cadastradas (registros)",
        valor: 243,
      }),
      indicador({
        id: "arvores_validas",
        nome: "Árvores com registro válido",
        definicao: "Registros ativos, com localização e origem conhecida.",
        valor: 200,
      }),
      indicador({
        id: "cobertura_inspecao",
        nome: "Inspecionadas nos últimos 12 meses",
        valor: 10,
        base: 200,
        unidade: "%",
      }),
      indicador({ id: "com_medidas", nome: "Com altura ou DAP", valor: 98.8, unidade: "%" }),
      indicador({
        id: "inspecoes_em_revisao",
        nome: "Inspeções aguardando revisão",
        valor: 6,
      }),
      indicador({ id: "tarefas_atrasadas", nome: "Tarefas atrasadas", valor: 4 }),
      indicador({ id: "ocorrencias_atrasadas", nome: "Ocorrências atrasadas", valor: 0 }),
      indicador({
        id: "tarefas_inspecao_pendentes",
        nome: "Inspeções pendentes (tarefas)",
        valor: 13,
      }),
    ],
    pendencias: [
      {
        id: "inspecoes_em_revisao",
        titulo: "Inspeções aguardando revisão",
        gravidade: "media",
        quantidade: 6,
        link: { pagina: "/inspecoes", filtros: { estado: "em_revisao" } },
      },
      {
        id: "tarefas_atrasadas",
        titulo: "Tarefas com prazo vencido",
        gravidade: "alta",
        quantidade: 4,
        link: { pagina: "/equipes-tarefas", filtros: { atrasadas: "true" } },
      },
    ],
  });

  it("a face do cartão não traz base, critério nem janela: isso fica em “Como é calculado”", async () => {
    await abrirComPainel(dados);
    const cartao = await cartaoDe("Inspecionadas nos últimos 12 meses");
    const detalhes = cartao.querySelector("details")!;
    for (const texto of [/^Base: 200/, /^Janela: fixa de 12 meses \(ignora o período\)/]) {
      expect(within(detalhes).getByText(texto)).toBeInTheDocument();
    }
    // Fora do <details>, só valor e nome (sem "Situação atual", "Base:" ou "Válido:").
    const face = cartao.cloneNode(true) as HTMLElement;
    face.querySelector("details")!.remove();
    expect(face.textContent).not.toMatch(/Base|ignora o período|Situação atual|Válido/);
    // O 1º cartão leva a contagem de registros para o "Como é calculado".
    const validas = await cartaoDe("Árvores com registro válido");
    expect(
      within(validas.querySelector("details")!).getByText(/^Base: 243 registros/),
    ).toBeInTheDocument();
  });

  it("os cartões esticam para a mesma altura na linha", async () => {
    await abrirComPainel(dados);
    for (const nome of ["Árvores com registro válido", "Inspecionadas nos últimos 12 meses"]) {
      const cartao = await cartaoDe(nome);
      expect(cartao.className).toMatch(/\bh-full\b/);
      expect(cartao.className).toMatch(/\bflex-col\b/);
    }
  });

  it("“Outros indicadores” não repete cartões nem pendências", async () => {
    await abrirComPainel(dados);
    const painelOutros = (await screen.findByRole("heading", { name: "Outros indicadores" }))
      .parentElement as HTMLElement;
    const lista = within(painelOutros);
    expect(lista.getByText("Com altura ou DAP")).toBeInTheDocument();
    expect(lista.getByText("Inspeções pendentes (tarefas)")).toBeInTheDocument();
    // Ocorrências atrasadas não está nas pendências (zero): continua aparecendo, com 0.
    expect(lista.getByText("Ocorrências atrasadas")).toBeInTheDocument();
    for (const repetido of [
      "Árvores cadastradas (registros)",
      "Árvores com registro válido",
      "Inspeções aguardando revisão",
      "Tarefas atrasadas",
    ]) {
      expect(lista.queryByText(repetido)).toBeNull();
    }
  });
});
