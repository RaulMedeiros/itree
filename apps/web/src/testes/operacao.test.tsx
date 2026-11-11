import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const API = "http://api.teste";

const GESTOR: Eu = {
  id: "u-ges",
  nome: "Gabriel Gestor",
  email: "gabriel@itree.teste",
  papeis: ["gestor"],
  permissoes: [
    "inspecoes.ler",
    "inspecoes.validar",
    "ocorrencias.ler",
    "tarefas.ler",
    "tarefas.editar",
    "relatorios.ler",
    "relatorios.exportar",
    "inventario.ler",
    "admin.equipes",
  ],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const pagina = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
const arvore = {
  id: "a-1",
  codigo: "ARV-000010",
  especie: null,
  especie_estado: "informada",
  localizacao: { longitude: -38.5, latitude: -3.7 },
  localizacao_origem: "importada",
  precisao_m: null,
  endereco: "Rua 1",
  bairro: "Meireles",
  condicao_aparente: "",
  condicao_aparente_em: null,
};
const tecnico = { id: "u-tec", nome: "Tiago Técnico", email: "t@itree.teste" };
const inspecao = (id: string, codigo: string, sinais: string[]) => ({
  id,
  codigo,
  arvore,
  tecnico,
  realizada_em: "2026-10-30T13:00:00Z",
  recebida_em: "2026-10-30T15:00:00Z",
  estado: "em_revisao",
  condicao_aparente: "ruim",
  sinais,
  especie: null,
  especie_texto: "",
  requer_encaminhamento: true,
  origem: "app",
  revisor: null,
  validada_em: null,
  versao: 1,
  localizacao: null,
  precisao_m: null,
  arvore_confirmada: true,
  observacoes: "",
  motivo_devolucao: "",
  aplicado_ao_cadastro: [],
  dispositivo: "",
  medidas: [],
  anterior: null,
  tarefa: null,
});
const equipe = (id: string, nome: string, membros: unknown[], territorios: unknown[]) => ({
  id,
  nome,
  descricao: "",
  ativa: true,
  coordenador: null,
  membros,
  territorios,
});
const tarefa = {
  id: "tf-1",
  codigo: "TAR-000001",
  tipo: "inspecao_arvore",
  descricao: "",
  alvo: { tipo: "arvore", id: "a-1", codigo: "ARV-000237" },
  responsavel: null,
  equipe: null,
  prazo: null,
  atrasada: false,
  estado: "nao_iniciada",
  motivo_estado: "",
  transicoes_possiveis: ["em_execucao", "bloqueada", "cancelada"],
};

let evidencias: unknown[] = [];
const consultasOcorrencias: URLSearchParams[] = [];

const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/territorios`, () => HttpResponse.json(pagina([]))),
  http.get(`${API}/api/v1/inspecoes`, () =>
    HttpResponse.json(
      pagina([
        inspecao("i-1", "INS-000001", ["fungos", "cavidade", "rachadura"]),
        inspecao("i-2", "INS-000002", ["fungos"]),
      ]),
    ),
  ),
  http.get(`${API}/api/v1/inspecoes/i-1`, () =>
    HttpResponse.json(inspecao("i-1", "INS-000001", ["fungos"])),
  ),
  http.get(`${API}/api/v1/inspecoes/i-1/historico`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/evidencias`, () => HttpResponse.json(evidencias)),
  http.get(`${API}/api/v1/ocorrencias`, ({ request }) => {
    consultasOcorrencias.push(new URL(request.url).searchParams);
    return HttpResponse.json(pagina([]));
  }),
  http.get(`${API}/api/v1/tipos-ocorrencia`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/equipes`, () =>
    HttpResponse.json(
      pagina([
        equipe("e-1", "Equipe Leste", [tecnico, tecnico], [{ id: "b", nome: "Meireles" }]),
        equipe("e-2", "Equipe de Poda Oeste", [], []),
      ]),
    ),
  ),
  http.get(`${API}/api/v1/tarefas`, () => HttpResponse.json(pagina([tarefa]))),
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
      linhas: [
        { rotulo: "A", valor: 88 },
        { rotulo: "B", valor: 85 },
      ],
      total: 173,
    }),
  ),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  evidencias = [];
  consultasOcorrencias.length = 0;
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

describe("inspeções", () => {
  it("lista sinais no singular e no plural e mostra há quanto tempo aguarda", async () => {
    await abrir("/inspecoes");
    expect(await screen.findByText("3 sinais")).toBeInTheDocument();
    expect(screen.getByText("1 sinal")).toBeInTheDocument();
    expect(screen.queryByText(/sinal\(is\)/)).toBeNull();
    expect(screen.getAllByText(/aguarda há \d+ dias/).length).toBe(2);
  });

  it("revisão sem evidências avisa no ponto de decisão e recolhe o histórico", async () => {
    await abrir("/inspecoes/i-1");
    const barra = await screen.findByRole("region", { name: "Decisão da revisão" });
    expect(await within(barra).findByText(/Sem evidências anexadas/)).toBeInTheDocument();
    expect(within(barra).getByRole("button", { name: "Validar…" })).toBeInTheDocument();
    const historico = screen.getByText("Histórico técnico").closest("details")!;
    expect(historico).not.toHaveAttribute("open");
  });

  it("com evidência anexada o aviso some", async () => {
    evidencias = [
      {
        id: "ev-1",
        nome_original: "foto.jpg",
        descricao: "Base do tronco",
        url: "http://x/foto.jpg",
        eh_imagem: true,
        enviada_por_nome: "Tiago",
        criado_em: "2026-10-30T13:00:00Z",
        capturada_em: null,
      },
    ];
    await abrir("/inspecoes/i-1");
    const barra = await screen.findByRole("region", { name: "Decisão da revisão" });
    await screen.findByAltText("Base do tronco");
    expect(within(barra).queryByText(/Sem evidências anexadas/)).toBeNull();
  });
});

describe("ocorrências", () => {
  it("abre em aberto e ordenada por urgência", async () => {
    await abrir("/ocorrencias");
    await screen.findByText("Nenhuma ocorrência encontrada");
    expect(consultasOcorrencias[0]?.get("estado")).toBe("abertas");
    expect(consultasOcorrencias[0]?.get("ordenar")).toBe("urgencia");
  });
});

describe("equipes e tarefas", () => {
  it("deixa uma ação principal na linha e move cancelar e bloquear para o menu", async () => {
    const usuario = userEvent.setup();
    await abrir("/equipes-tarefas");
    const linha = (await screen.findByText("TAR-000001")).closest("tr")!;
    expect(within(linha).getByRole("button", { name: "Iniciar" })).toBeInTheDocument();
    expect(within(linha).queryByRole("button", { name: "Cancelar" })).toBeNull();
    await usuario.click(within(linha).getByRole("button", { name: /Mais ações de TAR-000001/ }));
    expect(await screen.findByRole("menuitem", { name: "Cancelar" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Marcar como bloqueada" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Reatribuir" })).toBeInTheDocument();
  });

  it("cartões de equipe usam plural correto e marcam equipe incompleta", async () => {
    await abrir("/equipes-tarefas");
    expect(await screen.findByText(/2 membros · Meireles/)).toBeInTheDocument();
    expect(screen.getByText(/0 membros · sem território/)).toBeInTheDocument();
    expect(screen.getAllByText("Incompleta")).toHaveLength(1);
  });
});

describe("administração de equipes", () => {
  it("equipe ativa sem membros nem território mostra o próximo passo", async () => {
    await abrir("/administracao/equipes");
    expect(
      await screen.findByText("Adicione membros e território para receber tarefas."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Incompleta")).toHaveLength(1);
  });
});

describe("análises", () => {
  it("agrupa exportações num menu, com GeoJSON padronizado, e mostra o total", async () => {
    const usuario = userEvent.setup();
    await abrir("/analises");
    expect(await screen.findByText("Total")).toBeInTheDocument();
    expect(screen.getByText("173")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /GEOJSON/ })).toBeNull();
    await usuario.click(screen.getByRole("button", { name: /Exportar dados/ }));
    expect(
      await screen.findByRole("menuitem", { name: "Inventário (GeoJSON)" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(9);
  });
});
