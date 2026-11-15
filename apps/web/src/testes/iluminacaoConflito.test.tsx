import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("maplibre-gl", () => ({ setWorkerUrl: () => undefined }));
vi.mock("../mapa/Mapa", async () => ({
  Mapa: (await import("./MapaFalsoComponente")).MapaFalsoComponente,
}));

const API = "http://api.teste";

const COORDENADOR: Eu = {
  id: "u-1",
  nome: "Caio Coordenador",
  email: "caio@itree.teste",
  papeis: ["coordenador"],
  permissoes: [
    "mapa.ler",
    "inventario.ler",
    "tarefas.ler",
    "tarefas.editar",
    "relatorios.exportar",
    "inspecoes.ler",
    "ocorrencias.ler",
  ],
  territorios: [{ id: "t-for", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const POSTE = {
  codigo: "904705",
  distancia_m: 2.3,
  tipo: "CONCRETO DUPLO T",
  altura_min_m: 5,
  altura_max_m: 10,
  logradouro: "HERACLITO GRACA, AV",
};

const arvore = (extra: Record<string, unknown> = {}) => ({
  id: "a-1",
  codigo: "ARV-000001",
  especie: null,
  especie_estado: "informada",
  especie_texto_original: "Oiti",
  localizacao: { longitude: -38.540452, latitude: -3.746602 },
  localizacao_origem: "importada",
  precisao_m: null,
  endereco: "Av. Heráclito Graça, 100",
  bairro: { id: "b-1", nome: "Aldeota", tipo: "bairro" },
  situacao: "ativa",
  valida: true,
  origem_registro: "importacao",
  ocorrencias_abertas: 0,
  condicao_aparente: "ruim",
  criado_em: "2026-10-31T12:00:00Z",
  atualizado_em: "2026-10-31T12:00:00Z",
  poste: POSTE,
  ...extra,
});

const pagina = <T,>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

const consultas: URL[] = [];
const pedidosLote: Record<string, unknown>[] = [];
const exportacoes: URL[] = [];
let eu: Eu = COORDENADOR;
let resumo: Record<string, unknown>;

const RESUMO = {
  importada: true,
  quantidade: 2,
  fonte: "Prefeitura de Fortaleza, SEINF: Pontos de iluminação pública (dados abertos)",
  fonte_url: "https://dados.fortaleza.ce.gov.br/x.xlsx",
  licenca: "Creative Commons Atribuição-CompartilhaIgual (CC BY-SA)",
  data_referencia: "2022-11-16",
  ingerido_em: "2026-11-15T12:00:00Z",
  raio_conflito_m: 3,
  raio_provisorio: true,
  alturas_maximas_m: [5, 10, 14, 17, 25],
};

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/iluminacao/resumo`, () => HttpResponse.json(resumo)),
  http.get(`${API}/api/v1/iluminacao/arvores-proximas`, ({ request }) => {
    consultas.push(new URL(request.url));
    return HttpResponse.json(pagina([arvore(), arvore({ id: "a-2", codigo: "ARV-000002" })]));
  }),
  http.get(`${API}/api/v1/territorios`, () =>
    HttpResponse.json(pagina([{ id: "b-1", nome: "Aldeota", tipo: "bairro" }])),
  ),
  http.get(`${API}/api/v1/equipes`, () => HttpResponse.json(pagina([]))),
  http.post(`${API}/api/v1/tarefas/lote`, async ({ request }) => {
    pedidosLote.push((await request.json()) as Record<string, unknown>);
    return HttpResponse.json(
      { criadas: 2, ignoradas: 0, fora_do_escopo_do_responsavel: 0 },
      { status: 201 },
    );
  }),
  http.get(`${API}/api/v1/relatorios/exportar`, ({ request }) => {
    exportacoes.push(new URL(request.url));
    return new HttpResponse("codigo\nARV-000001\n", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="itree-arvores_iluminacao.csv"',
      },
    });
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
  // O download do CSV usa o objeto URL do navegador, ausente no jsdom.
  URL.createObjectURL = vi.fn(() => "blob:teste");
  URL.revokeObjectURL = vi.fn();
});
beforeEach(() => {
  consultas.length = 0;
  pedidosLote.length = 0;
  exportacoes.length = 0;
  eu = COORDENADOR;
  resumo = { ...RESUMO };
});
afterEach(() => {
  servidor.resetHandlers();
  cleanup();
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

describe("Árvores próximas à iluminação (conflito poste × copa)", () => {
  it("é uma aba do Inventário e mostra o selo e o aviso de raio provisório", async () => {
    await abrir("/inventario/iluminacao");
    expect(
      await screen.findByRole("heading", { name: "Árvores próximas à iluminação" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Árvores próximas à iluminação" })).toBeInTheDocument();
    expect(screen.getByText("Provisório")).toBeInTheDocument();
    const aviso = await screen.findByRole("note");
    expect(
      within(aviso).getByText(/raio provisório, a definir pela URBFOR e pela SEINF/),
    ).toBeInTheDocument();
    expect(within(aviso).getByText(/Proximidade não é conflito comprovado/)).toBeInTheDocument();
    expect(within(aviso).getByText(/CC BY-SA/)).toBeInTheDocument();
    expect(screen.getByText(/a até 3 m/)).toBeInTheDocument();
  });

  it("lista as árvores com distância e poste mais próximo (tipo e altura)", async () => {
    await abrir("/inventario/iluminacao");
    const tabela = await screen.findByRole("table");
    expect(within(tabela).getByText("ARV-000001")).toBeInTheDocument();
    expect(within(tabela).getAllByText("2,3 m")).toHaveLength(2);
    expect(within(tabela).getAllByText(/Concreto Duplo T, 5 a 10 m/)).toHaveLength(2);
    expect(within(tabela).getAllByText(/Ponto 904705 · Heraclito Graca, Av/)).toHaveLength(2);
  });

  it("filtra por altura do poste e por bairro na consulta", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/iluminacao");
    await screen.findByRole("table");
    await usuario.selectOptions(await screen.findByLabelText("Altura do poste"), "14");
    await vi.waitFor(() =>
      expect(consultas.at(-1)?.searchParams.get("altura_poste_max_m")).toBe("14"),
    );
    await usuario.selectOptions(await screen.findByLabelText("Bairro"), "b-1");
    await vi.waitFor(() => expect(consultas.at(-1)?.searchParams.get("bairro")).toBe("b-1"));
  });

  it("cria tarefas de inspeção para as árvores marcadas, com a ação em lote que já existe", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/iluminacao");
    await usuario.click(await screen.findByRole("checkbox", { name: "Selecionar ARV-000001" }));
    await usuario.click(await screen.findByRole("button", { name: "Criar tarefas de inspeção" }));
    const dialogo = await screen.findByRole("dialog");
    await usuario.click(within(dialogo).getByRole("button", { name: "Criar" }));
    await vi.waitFor(() => expect(pedidosLote).toHaveLength(1));
    expect(pedidosLote[0]).toMatchObject({ arvore_ids: ["a-1"] });
  });

  it("sem permissão de editar tarefas, não oferece a ação em lote", async () => {
    eu = { ...COORDENADOR, permissoes: ["mapa.ler", "inventario.ler"] };
    const usuario = userEvent.setup();
    await abrir("/inventario/iluminacao");
    await usuario.click(await screen.findByRole("checkbox", { name: "Selecionar ARV-000001" }));
    expect(screen.queryByRole("button", { name: "Criar tarefas de inspeção" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Exportar CSV/ })).toBeNull();
  });

  it("exporta o CSV com os filtros da lista", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/iluminacao?altura_poste_max_m=10");
    await usuario.click(await screen.findByRole("button", { name: /Exportar CSV/ }));
    await vi.waitFor(() => expect(exportacoes).toHaveLength(1));
    expect(exportacoes[0]!.searchParams.get("conjunto")).toBe("arvores_iluminacao");
    expect(exportacoes[0]!.searchParams.get("formato")).toBe("csv");
    expect(exportacoes[0]!.searchParams.get("altura_poste_max_m")).toBe("10");
  });

  it("sem a fonte importada, diz isso em vez de 'nenhuma árvore'", async () => {
    resumo = { ...RESUMO, importada: false, quantidade: 0 };
    servidor.use(
      http.get(`${API}/api/v1/iluminacao/arvores-proximas`, () => HttpResponse.json(pagina([]))),
    );
    await abrir("/inventario/iluminacao");
    expect(
      await screen.findByText("Os pontos de iluminação ainda não foram importados"),
    ).toBeInTheDocument();
  });
});

describe("poste mais próximo na ficha da árvore", () => {
  const ficha = (poste: unknown) =>
    http.get(`${API}/api/v1/arvores/a-1`, () =>
      HttpResponse.json({
        ...arvore(),
        identificadores: [],
        medidas_atuais: [],
        observacoes: "",
        criado_por_nome: "Rita",
        motivo_situacao: "",
        em_area_verde: null,
        poste_mais_proximo: poste,
      }),
    );
  const base = [
    http.get(`${API}/api/v1/arvores/a-1/historico`, () => HttpResponse.json([])),
    http.get(`${API}/api/v1/inspecoes`, () => HttpResponse.json(pagina([]))),
    http.get(`${API}/api/v1/evidencias`, () => HttpResponse.json([])),
    http.get(`${API}/api/v1/ocorrencias`, () => HttpResponse.json(pagina([]))),
    http.get(`${API}/api/v1/tarefas`, () => HttpResponse.json(pagina([]))),
  ];

  it("mostra distância, tipo e altura quando há um poste a até 15 m", async () => {
    servidor.use(ficha(POSTE), ...base);
    await abrir("/inventario/arvores/a-1");
    expect(await screen.findByText("Poste mais próximo")).toBeInTheDocument();
    expect(screen.getByTestId("poste-mais-proximo")).toHaveTextContent(
      "Concreto Duplo T, 5 a 10 m · a 2,3 m",
    );
    expect(screen.getByText(/Prefeitura de Fortaleza, SEINF, dados abertos \(CC BY-SA\)/));
  });

  it("não mostra nada quando não há poste por perto", async () => {
    servidor.use(ficha(null), ...base);
    await abrir("/inventario/arvores/a-1");
    await screen.findByText("Identificadores externos");
    expect(screen.queryByText("Poste mais próximo")).toBeNull();
  });
});
