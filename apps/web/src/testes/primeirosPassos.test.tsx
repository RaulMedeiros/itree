import { configurarCliente, type Eu, type Passo } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { contarFiltros } from "../util/filtros";
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
vi.mock("../paginas/visao-geral/MapaResumo", () => ({ MapaResumo: () => null }));

const API = "http://api.teste";

const ADMIN: Eu = {
  id: "u-admin",
  nome: "Ana Admin",
  email: "ana@itree.teste",
  papeis: ["administrador"],
  permissoes: [
    "mapa.ler",
    "inventario.ler",
    "inventario.importar",
    "inventario.editar",
    "inspecoes.ler",
    "ocorrencias.ler",
    "ocorrencias.editar",
    "alertas.ler",
    "tarefas.ler",
    "tarefas.editar",
    "relatorios.ler",
    "admin.configuracao",
  ],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};
const GESTOR: Eu = {
  ...ADMIN,
  papeis: ["gestor"],
  permissoes: ADMIN.permissoes.filter(
    (p) => !["admin.configuracao", "inventario.importar"].includes(p),
  ),
};

const passo = (id: string, titulo: string, concluido: boolean, link: string): Passo => ({
  id,
  titulo,
  descricao: `Descrição de ${titulo}`,
  concluido,
  detalhe: concluido ? "Feito." : "Nada ainda.",
  link,
});
const PASSOS: Passo[] = [
  passo("territorios", "Importar os territórios", true, "/administracao/territorios"),
  passo("especies", "Montar o catálogo de espécies", false, "/inventario/especies"),
  passo("inventario", "Importar o inventário", false, "/inventario/importacoes"),
];

let eu: Eu = ADMIN;
let completo = false;
let consultouChecklist = 0;
const vazio = { count: 0, next: null, previous: null, results: [] };

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/implantacao/primeiros-passos`, () => {
    consultouChecklist += 1;
    return HttpResponse.json({ completo, passos: PASSOS });
  }),
  http.get(`${API}/api/v1/indicadores/painel`, () =>
    HttpResponse.json({
      periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
      filtros: { bairro: null, equipe: null },
      calculado_em: "2026-10-31T12:00:00Z",
      indicadores: [],
      distribuicoes: {},
      series_mensais: { meses: [], definicao: "", series: [] },
      pendencias: [],
      equipes: [],
      atividades: [],
    }),
  ),
  http.get(`${API}/api/v1/territorios`, () => HttpResponse.json(vazio)),
  http.get(`${API}/api/v1/equipes`, () => HttpResponse.json(vazio)),
  http.get(`${API}/api/v1/arvores`, () => HttpResponse.json(vazio)),
  http.get(`${API}/api/v1/arvores/contadores`, () =>
    HttpResponse.json({ total: 0, validos: 0, limite_tarefas_em_lote: 500 }),
  ),
  http.get(`${API}/api/v1/especies`, () => HttpResponse.json(vazio)),
  http.get(`${API}/api/v1/ocorrencias`, () => HttpResponse.json(vazio)),
  http.get(`${API}/api/v1/tipos-ocorrencia`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/inspecoes`, () => HttpResponse.json(vazio)),
  http.get(`${API}/api/v1/tarefas`, () => HttpResponse.json(vazio)),
  http.get(`${API}/api/v1/alertas`, () => HttpResponse.json(vazio)),
  http.get(`${API}/api/v1/alertas/ingestoes`, () => HttpResponse.json([])),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  eu = ADMIN;
  completo = false;
  consultouChecklist = 0;
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

describe("Primeiros passos na visão geral (G-03)", () => {
  it("mostra o checklist do servidor, com marca e link em cada passo", async () => {
    await abrir("/visao-geral");
    const quadro = await screen.findByRole("region", { name: "Primeiros passos" });
    expect(within(quadro).getByText("1 de 3 concluídos")).toBeInTheDocument();
    const fazer = within(quadro).getByRole("link", { name: /Montar o catálogo de espécies/ });
    expect(fazer).toHaveAttribute("href", "/inventario/especies");
    expect(fazer).toHaveTextContent("Fazer agora");
    expect(within(quadro).getByRole("link", { name: /Importar os territórios/ })).toHaveTextContent(
      "Ver",
    );
    expect(within(quadro).getAllByText(/\(concluído\)/)).toHaveLength(1);
    expect(within(quadro).getAllByText(/\(pendente\)/)).toHaveLength(2);
  });

  it("some quando o servidor diz que a implantação está completa", async () => {
    completo = true;
    await abrir("/visao-geral");
    await screen.findByRole("heading", { name: "Visão geral" });
    await vi.waitFor(() => expect(consultouChecklist).toBe(1));
    expect(screen.queryByRole("region", { name: "Primeiros passos" })).toBeNull();
  });

  it("não aparece nem consulta o servidor para quem não administra", async () => {
    eu = GESTOR;
    await abrir("/visao-geral");
    await screen.findByRole("heading", { name: "Visão geral" });
    expect(screen.queryByRole("region", { name: "Primeiros passos" })).toBeNull();
    expect(consultouChecklist).toBe(0);
  });
});

describe("estados vazios das listas (G-03)", () => {
  it("árvores: base vazia orienta a importar ou cadastrar", async () => {
    await abrir("/inventario/arvores");
    expect(await screen.findByText("Ainda não há árvores cadastradas")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Importar inventário existente" })).toHaveAttribute(
      "href",
      "/inventario/importacoes",
    );
    expect(screen.getByRole("button", { name: /Cadastrar árvore/ })).toBeInTheDocument();
  });

  it("árvores: com filtro, o vazio é do filtro e oferece limpá-lo", async () => {
    await abrir("/inventario/arvores?especie_estado=confirmada");
    expect(
      await screen.findByText("Nenhum resultado para os filtros escolhidos"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpar filtros" })).toBeInTheDocument();
    expect(screen.queryByText("Ainda não há árvores cadastradas")).toBeNull();
  });

  it("ocorrências, inspeções, tarefas e alertas têm texto e ação", async () => {
    await abrir("/ocorrencias");
    expect(await screen.findByText("Ainda não há ocorrências registradas")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Registrar ocorrência/ }).length).toBeGreaterThan(
      1,
    );
  });

  it("inspeções: aponta para as tarefas de inspeção", async () => {
    await abrir("/inspecoes");
    expect(await screen.findByText("Nenhuma inspeção aguardando revisão")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver tarefas de inspeção" })).toHaveAttribute(
      "href",
      "/equipes-tarefas",
    );
  });

  it("tarefas: aponta para o inventário", async () => {
    await abrir("/equipes-tarefas");
    expect(await screen.findByText("Ainda não há tarefas")).toBeInTheDocument();
    const acoes = screen.getAllByRole("link", { name: "Criar tarefas a partir do inventário" });
    expect(acoes.length).toBe(2);
  });

  it("alertas: administrador vai configurar as fontes; os demais são orientados", async () => {
    await abrir("/alertas");
    expect(await screen.findByText("Ainda não há alertas")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configurar fontes externas" })).toHaveAttribute(
      "href",
      "/administracao/integracoes",
    );
  });

  it("alertas: quem não administra não vê o link de configuração", async () => {
    eu = GESTOR;
    await abrir("/alertas");
    expect(await screen.findByText("Ainda não há alertas")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Configurar fontes externas" })).toBeNull();
    expect(screen.getByText(/Peça a quem administra o sistema/)).toBeInTheDocument();
  });
});

describe("contarFiltros", () => {
  it("ignora página, ordem, valores vazios e os padrões informados", () => {
    expect(contarFiltros({})).toBe(0);
    expect(contarFiltros({ pagina: 2, ordenar: "-numero", busca: "", bairro: undefined })).toBe(0);
    expect(contarFiltros({ busca: "oiti", estado: "abertas", pagina: 3 })).toBe(2);
    expect(contarFiltros({ raio: 500, estado: "abertas" }, ["raio"])).toBe(1);
  });
});
