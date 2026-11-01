import { configurarCliente, type Eu, type Ocorrencia } from "@itree/api-client";
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
// O MapLibre precisa de WebGL, ausente no jsdom; as telas testadas aqui não usam o mapa.
vi.mock("maplibre-gl", () => ({ setWorkerUrl: () => undefined }));

const API = "http://api.teste";

const GESTOR: Eu = {
  id: "u-gestor",
  nome: "Gabi Gestora",
  email: "gabi@itree.teste",
  papeis: ["gestor"],
  permissoes: [
    "mapa.ler",
    "inventario.ler",
    "ocorrencias.ler",
    "ocorrencias.editar",
    "ocorrencias.priorizar",
    "tarefas.ler",
  ],
  territorios: [{ id: "t-for", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const OCORRENCIA: Ocorrencia = {
  id: "o-1",
  codigo: "OCO-000007",
  tipo: { id: "t-1", nome: "Galho caído", descricao: "", prazo_padrao_dias: 3, ativo: true },
  arvore: { id: "a-1", codigo: "ARV-000042" },
  localizacao: { longitude: -38.5, latitude: -3.7 },
  bairro: { id: "b-1", nome: "Meireles", tipo: "bairro" },
  endereco: "Av. Beira Mar, 100",
  descricao: "Galho sobre a calçada",
  condicao_aparente: "Galho aparentemente quebrado",
  prioridade: "",
  prioridade_definida_por: null,
  prioridade_definida_em: null,
  risco_confirmado: false,
  risco_descricao: "",
  risco_responsavel: null,
  risco_registrado_em: null,
  estado: "aberta",
  transicoes_possiveis: ["em_triagem", "cancelada"],
  responsavel: null,
  equipe: null,
  prazo: "2026-11-03",
  atrasada: false,
  origem: "web",
  origem_referencia: "",
  registrada_por: { id: "u-gestor", nome: "Gabi Gestora", email: "gabi@itree.teste" },
  criado_em: "2026-10-31T12:00:00Z",
  atualizado_em: "2026-10-31T12:00:00Z",
  concluida_em: null,
};

const transicoes: unknown[] = [];
const pagina = <T,>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/ocorrencias/o-1`, () => HttpResponse.json(OCORRENCIA)),
  http.get(`${API}/api/v1/ocorrencias/o-1/historico`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/evidencias`, () => HttpResponse.json([])),
  http.post(`${API}/api/v1/ocorrencias/o-1/transicao`, async ({ request }) => {
    const corpo = (await request.json()) as { estado: string };
    transicoes.push(corpo);
    return HttpResponse.json({ ...OCORRENCIA, estado: corpo.estado, transicoes_possiveis: [] });
  }),
  http.get(`${API}/api/v1/arvores`, () =>
    HttpResponse.json(
      pagina([
        {
          id: "a-1",
          codigo: "ARV-000042",
          especie: null,
          especie_estado: "informada",
          especie_texto_original: "Oiti",
          localizacao: { longitude: -38.5, latitude: -3.7 },
          localizacao_origem: "importada",
          precisao_m: 4,
          endereco: "Rua 1",
          bairro: null,
          situacao: "ativa",
          valida: true,
          origem_registro: "importacao",
          ocorrencias_abertas: 1,
          criado_em: "2026-10-31T12:00:00Z",
          atualizado_em: "2026-10-31T12:00:00Z",
        },
      ]),
    ),
  ),
  http.get(`${API}/api/v1/arvores/contadores`, () =>
    HttpResponse.json({ total: 1250, validos: 1190 }),
  ),
  http.get(`${API}/api/v1/especies`, () => HttpResponse.json(pagina([]))),
  http.get(`${API}/api/v1/territorios`, () => HttpResponse.json(pagina([]))),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  transicoes.length = 0;
});
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
}

describe("ocorrência", () => {
  it("separa condição aparente, prioridade operacional e risco confirmado", async () => {
    await abrir("/ocorrencias/o-1");
    for (const titulo of ["Condição aparente", "Prioridade operacional", "Risco confirmado"]) {
      expect(await screen.findByRole("heading", { name: titulo })).toBeInTheDocument();
    }
    expect(screen.getByText("Galho aparentemente quebrado")).toBeInTheDocument();
    expect(screen.getByText("Sem prioridade definida")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma avaliação técnica registrada.")).toBeInTheDocument();
    // Gestor não tem permissão de registrar risco.
    expect(screen.queryByRole("button", { name: /Registrar$/ })).not.toBeInTheDocument();
  });

  it("cancelar exige justificativa", async () => {
    const usuario = userEvent.setup();
    await abrir("/ocorrencias/o-1");
    await usuario.click(await screen.findByRole("button", { name: "Cancelar" }));
    const dialogo = await screen.findByRole("dialog");
    const confirmar = within(dialogo).getByRole("button", { name: "Confirmar" });
    expect(confirmar).toBeDisabled();
    await usuario.type(
      within(dialogo).getByLabelText(/Justificativa do cancelamento/),
      "Duplicada",
    );
    await usuario.click(confirmar);
    await vi.waitFor(() =>
      expect(transicoes).toEqual([{ estado: "cancelada", motivo: "Duplicada" }]),
    );
  });
});

describe("inventário", () => {
  it("mostra total e válidos e a origem da localização", async () => {
    await abrir("/inventario/arvores");
    expect(await screen.findByRole("link", { name: "ARV-000042" })).toBeInTheDocument();
    expect(screen.getByText("1.250")).toBeInTheDocument();
    expect(screen.getByText("1.190")).toBeInTheDocument();
    const tabela = screen.getByRole("table");
    expect(within(tabela).getByText("Importada · ±4 m")).toBeInTheDocument();
    expect(within(tabela).getByText("Informada (não validada)")).toBeInTheDocument();
    expect(within(tabela).getByText("“Oiti” (fora do catálogo)")).toBeInTheDocument();
  });
});
