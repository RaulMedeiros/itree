import { configurarCliente, type Eu, type Ocorrencia } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { criarServidor } from "./servidorPadrao";
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
  tipo: {
    id: "t-1",
    nome: "Galho caído",
    descricao: "",
    prazo_padrao_dias: 3,
    ativo: true,
    ocorrencias_por_estado: {
      aberta: 1,
      em_triagem: 0,
      encaminhada: 0,
      em_atendimento: 0,
      concluida: 0,
      cancelada: 0,
    },
  },
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
  origem_vinculo: null,
  tarefas: [],
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

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/ocorrencias/o-1`, () => HttpResponse.json(OCORRENCIA)),
  http.get(`${API}/api/v1/ocorrencias/o-1/historico`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/evidencias`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/equipes`, () =>
    HttpResponse.json(
      pagina([
        {
          id: "e-1",
          nome: "Equipe Leste",
          descricao: "",
          ativa: true,
          coordenador: null,
          membros: [{ id: "u-1", nome: "Téo Técnico", email: "teo@itree.teste" }],
          territorios: [{ id: "b-1", nome: "Meireles" }],
        },
        {
          id: "e-2",
          nome: "Equipe de Poda Oeste",
          descricao: "",
          ativa: true,
          coordenador: null,
          membros: [],
          territorios: [],
        },
      ]),
    ),
  ),
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

  it("destaca prioridade e situação, deixa condição e risco como contexto e recolhe o histórico", async () => {
    await abrir("/ocorrencias/o-1");
    const destaque = (titulo: string) =>
      screen.getByRole("heading", { name: titulo }).closest("section")!;
    await screen.findByRole("heading", { name: "Situação" });
    for (const titulo of ["Prioridade operacional", "Situação"]) {
      expect(destaque(titulo).className).toMatch(/border-l-4/);
    }
    for (const titulo of ["Condição aparente", "Risco confirmado"]) {
      expect(destaque(titulo).className).not.toMatch(/border-l-4/);
    }
    // A situação sai do cabeçalho e fica no cartão em destaque.
    expect(within(destaque("Situação")).getByText("Aberta")).toBeInTheDocument();
    const historico = screen.getByText("Histórico de encaminhamentos").closest("details")!;
    expect(historico).not.toHaveAttribute("open");
  });

  it("avisa antes de concluir sem responsável nem evidência e mostra o prazo restante", async () => {
    const usuario = userEvent.setup();
    servidor.use(
      http.get(`${API}/api/v1/ocorrencias/o-1`, () =>
        HttpResponse.json({
          ...OCORRENCIA,
          estado: "em_atendimento",
          transicoes_possiveis: ["concluida", "cancelada"],
          prazo: "2999-12-31",
        }),
      ),
    );
    await abrir("/ocorrencias/o-1");
    expect(await screen.findByText("Sem responsável")).toBeInTheDocument();
    expect(screen.getByText(/· faltam \d+ dias/)).toBeInTheDocument();
    await usuario.click(await screen.findByRole("button", { name: "Concluir" }));
    const dialogo = await screen.findByRole("dialog");
    expect(
      await within(dialogo).findByText(/sem responsável atribuído e sem evidência anexada/),
    ).toBeInTheDocument();
  });

  it("avisa, sem bloquear, ao atribuir a uma equipe incompleta", async () => {
    const usuario = userEvent.setup();
    await abrir("/ocorrencias/o-1");
    await usuario.click(await screen.findByRole("button", { name: "Alterar" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).queryByRole("note")).toBeNull();

    await within(dialogo).findByRole("option", { name: "Equipe de Poda Oeste" });
    await usuario.selectOptions(within(dialogo).getByLabelText("Equipe"), "e-2");
    expect(await within(dialogo).findByRole("note")).toHaveTextContent(
      /Equipe de Poda Oeste está incompleta \(sem membros e sem território\)/,
    );
    expect(within(dialogo).getByRole("button", { name: "Salvar" })).toBeEnabled();

    await usuario.selectOptions(within(dialogo).getByLabelText("Equipe"), "e-1");
    expect(within(dialogo).queryByRole("note")).toBeNull();
  });

  it("mostra a origem na inspeção, com link, e as tarefas vinculadas com o estado", async () => {
    servidor.use(
      http.get(`${API}/api/v1/ocorrencias/o-1`, () =>
        HttpResponse.json({
          ...OCORRENCIA,
          origem: "inspecao",
          origem_referencia: "INS-000009",
          origem_vinculo: { tipo: "inspecao", id: "i-9", codigo: "INS-000009" },
          tarefas: [
            {
              id: "tf-1",
              codigo: "TAR-000004",
              estado: "bloqueada",
              responsavel: "Tiago Técnico",
              prazo: "2999-12-31",
            },
          ],
        }),
      ),
    );
    await abrir("/ocorrencias/o-1");
    const origem = (await screen.findByText("Origem")).closest("div")!;
    expect(within(origem).getByText(/Encaminhamento de inspeção/)).toBeInTheDocument();
    expect(within(origem).getByRole("link", { name: "INS-000009" })).toHaveAttribute(
      "href",
      "/inspecoes/i-9",
    );
    const tarefas = screen.getByRole("heading", { name: "Tarefas vinculadas" }).closest("section")!;
    expect(within(tarefas).getByText("TAR-000004")).toBeInTheDocument();
    expect(within(tarefas).getByText("Bloqueada")).toBeInTheDocument();
    expect(within(tarefas).getByText(/Tiago Técnico/)).toBeInTheDocument();
  });

  it("sem tarefas vinculadas, diz que não há", async () => {
    await abrir("/ocorrencias/o-1");
    expect(await screen.findByText("Nenhuma tarefa de atendimento criada.")).toBeInTheDocument();
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
