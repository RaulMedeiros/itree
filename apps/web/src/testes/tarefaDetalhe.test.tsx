import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

const API = "http://api.teste";

const GESTOR: Eu = {
  id: "u-ges",
  nome: "Gabriel Gestor",
  email: "gabriel@itree.teste",
  papeis: ["gestor"],
  permissoes: [
    "inspecoes.ler",
    "ocorrencias.ler",
    "tarefas.ler",
    "tarefas.editar",
    "inventario.ler",
    "admin.auditoria",
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

const atendimento = {
  id: "tf-1",
  codigo: "TAR-000012",
  tipo: "atendimento_ocorrencia",
  descricao: "Podar o galho sobre a fiação",
  alvo: { tipo: "ocorrencia", id: "o-1", codigo: "OCO-000007" },
  origem: { tipo: "inspecao", id: "i-1", codigo: "INS-000003" },
  localizacao: { longitude: -38.5, latitude: -3.7 },
  responsavel: { id: "u-tec", nome: "Tiago Técnico", email: "t@itree.teste" },
  equipe: { id: "e-1", nome: "Equipe Leste" },
  prazo: "2099-01-10",
  prioridade: "alta",
  estado: "em_execucao",
  motivo_estado: "",
  resultado: "",
  exige_evidencia: true,
  total_evidencias: 0,
  transicoes_possiveis: ["concluida", "bloqueada", "cancelada"],
  atrasada: false,
  criada_por: { id: "u-ges", nome: "Gabriel Gestor", email: "gabriel@itree.teste" },
  criado_em: "2026-11-01T12:00:00Z",
  atualizado_em: "2026-11-02T12:00:00Z",
  concluida_em: null,
};

const foto = {
  id: "ev-1",
  nome_original: "poda.jpg",
  tipo_conteudo: "image/jpeg",
  tamanho: 10,
  descricao: "Galho removido",
  capturada_em: null,
  estado: "disponivel",
  ilustrativa: false,
  eh_imagem: true,
  url: null,
  enviada_por_nome: "Tiago Técnico",
  arvore: null,
  ocorrencia: null,
  tarefa: "tf-1",
  criado_em: "2026-11-03T12:00:00Z",
};

const evento = {
  id: "h-1",
  momento: "2026-11-02T12:00:00Z",
  entidade: "Tarefa",
  entidade_modelo: "tarefas.TarefaEvent",
  objeto_id: "tf-1",
  registro: "TAR-000012",
  pai: null,
  acao: "alteracao",
  diferencas: { estado: ["nao_iniciada", "em_execucao"] },
  dados: {},
  autor_nome: "Tiago Técnico",
  contexto: { origem: "web" },
};

let tarefaAtual: Record<string, unknown> = atendimento;
let evidencias: unknown[] = [];
const transicoes: unknown[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/tarefas/tf-1`, () => HttpResponse.json(tarefaAtual)),
  http.get(`${API}/api/v1/tarefas/tf-1/historico`, () => HttpResponse.json([evento])),
  http.get(`${API}/api/v1/evidencias`, () => HttpResponse.json(evidencias)),
  http.get(`${API}/api/v1/tarefas`, () => HttpResponse.json(pagina([tarefaAtual]))),
  http.get(`${API}/api/v1/equipes`, () => HttpResponse.json(pagina([]))),
  http.post(`${API}/api/v1/tarefas/tf-1/transicao`, async ({ request }) => {
    transicoes.push(await request.json());
    return HttpResponse.json({ ...tarefaAtual, estado: "concluida" });
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  tarefaAtual = atendimento;
  evidencias = [];
  transicoes.length = 0;
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

describe("detalhe da tarefa", () => {
  it("mostra origem com link, equipe, responsável, prazo, estado e histórico legível", async () => {
    await abrir("/equipes-tarefas/tf-1");
    expect(
      await screen.findByRole("heading", { name: "TAR-000012 · Atendimento de ocorrência" }),
    ).toBeInTheDocument();
    const migalhas = screen.getByRole("navigation", { name: "Migalhas" });
    expect(within(migalhas).getByRole("link", { name: "Equipes e tarefas" })).toHaveAttribute(
      "href",
      "/equipes-tarefas",
    );
    expect(screen.getByRole("link", { name: "OCO-000007" })).toHaveAttribute(
      "href",
      "/ocorrencias/o-1",
    );
    expect(screen.getByRole("link", { name: "INS-000003" })).toHaveAttribute(
      "href",
      "/inspecoes/i-1",
    );
    expect(screen.getByText("Equipe Leste")).toBeInTheDocument();
    expect(screen.getByText("Tiago Técnico", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText(/10\/01\/2099/)).toBeInTheDocument();
    expect(screen.getByText("Em execução")).toBeInTheDocument();
    // Histórico com rótulos humanos, sem chaves técnicas.
    const historico = screen.getByRole("heading", { name: "Histórico" }).closest("section")!;
    expect(await within(historico).findByText("Estado")).toBeInTheDocument();
    expect(within(historico).getByText("Não iniciada")).toBeInTheDocument();
  });

  it("as ações seguem o estado: iniciar, concluir e nenhuma depois de concluída", async () => {
    tarefaAtual = {
      ...atendimento,
      estado: "nao_iniciada",
      transicoes_possiveis: ["em_execucao", "bloqueada", "cancelada"],
    };
    await abrir("/equipes-tarefas/tf-1");
    expect(await screen.findByRole("button", { name: "Iniciar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Concluir" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("tarefa concluída não oferece ações e mostra o resultado", async () => {
    tarefaAtual = {
      ...atendimento,
      estado: "concluida",
      transicoes_possiveis: [],
      resultado: "Galho podado e retirado",
      concluida_em: "2026-11-05T12:00:00Z",
    };
    await abrir("/equipes-tarefas/tf-1");
    expect(await screen.findByText("Galho podado e retirado")).toBeInTheDocument();
    expect(screen.queryByText("Próximo passo:")).toBeNull();
    expect(screen.queryByRole("button", { name: "Concluir" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Adicionar foto/ })).toBeNull();
  });

  it("concluir tarefa de campo sem foto fica bloqueado e explica o que falta", async () => {
    const usuario = userEvent.setup();
    await abrir("/equipes-tarefas/tf-1");
    await usuario.click(await screen.findByRole("button", { name: "Concluir" }));
    const dialogo = await screen.findByRole("dialog");
    await usuario.type(within(dialogo).getByLabelText(/Resultado/), "Galho podado");
    expect(within(dialogo).getByText(/anexe ao menos uma foto/)).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Confirmar" })).toBeDisabled();
    expect(transicoes).toEqual([]);
  });

  it("com foto anexada, concluir pede o resultado e o envia", async () => {
    const usuario = userEvent.setup();
    evidencias = [foto];
    await abrir("/equipes-tarefas/tf-1");
    await usuario.click(await screen.findByRole("button", { name: "Concluir" }));
    const dialogo = await screen.findByRole("dialog");
    const confirmar = within(dialogo).getByRole("button", { name: "Confirmar" });
    expect(within(dialogo).queryByText(/anexe ao menos uma foto/)).toBeNull();
    expect(confirmar).toBeDisabled(); // falta o resultado
    await usuario.type(within(dialogo).getByLabelText(/Resultado/), "Galho podado");
    await usuario.click(confirmar);
    await vi.waitFor(() =>
      expect(transicoes).toEqual([{ estado: "concluida", motivo: "", resultado: "Galho podado" }]),
    );
  });

  it("tarefa de inspeção não exige foto, só o resultado", async () => {
    const usuario = userEvent.setup();
    tarefaAtual = {
      ...atendimento,
      tipo: "inspecao_arvore",
      alvo: { tipo: "arvore", id: "a-1", codigo: "ARV-000010" },
      origem: null,
      exige_evidencia: false,
    };
    await abrir("/equipes-tarefas/tf-1");
    await usuario.click(await screen.findByRole("button", { name: "Concluir" }));
    const dialogo = await screen.findByRole("dialog");
    await usuario.type(within(dialogo).getByLabelText(/Resultado/), "Vistoria feita");
    expect(within(dialogo).getByRole("button", { name: "Confirmar" })).toBeEnabled();
  });
});

describe("códigos TAR com link", () => {
  it("na lista de tarefas o código abre o detalhe", async () => {
    await abrir("/equipes-tarefas");
    expect(await screen.findByRole("link", { name: "TAR-000012" })).toHaveAttribute(
      "href",
      "/equipes-tarefas/tf-1",
    );
  });

  it("na lista, concluir tarefa de campo sem foto aponta para o detalhe", async () => {
    const usuario = userEvent.setup();
    await abrir("/equipes-tarefas");
    await usuario.click(await screen.findByRole("button", { name: "Concluir" }));
    const dialogo = await screen.findByRole("dialog");
    expect(
      within(dialogo).getByRole("link", { name: "Abrir a tarefa para anexar a foto" }),
    ).toHaveAttribute("href", "/equipes-tarefas/tf-1");
  });

  it("na auditoria, o código da tarefa e o da evidência dela abrem o detalhe", async () => {
    servidor.use(
      http.get(`${API}/api/v1/admin/auditoria`, () =>
        HttpResponse.json(
          pagina([
            {
              ...evento,
              id: "x-1",
            },
            {
              ...evento,
              id: "x-2",
              entidade: "Evidência",
              entidade_modelo: "evidencias.EvidenciaEvent",
              registro: null,
              pai: { tipo: "tarefa", id: "tf-1", codigo: "TAR-000012" },
            },
          ]),
        ),
      ),
    );
    await abrir("/administracao/auditoria");
    const links = await screen.findAllByRole("link", { name: /TAR-000012/ });
    expect(links).toHaveLength(2);
    for (const l of links) expect(l).toHaveAttribute("href", "/equipes-tarefas/tf-1");
  });

  it("na ocorrência, as tarefas vinculadas têm link", async () => {
    servidor.use(
      http.get(`${API}/api/v1/ocorrencias/o-1`, () =>
        HttpResponse.json({
          id: "o-1",
          codigo: "OCO-000007",
          tipo: { id: "tp", nome: "Galho caído", descricao: "", prazo_padrao_dias: 3, ativo: true },
          arvore: null,
          localizacao: { longitude: -38.5, latitude: -3.7 },
          endereco: "",
          bairro: "Meireles",
          descricao: "Galho",
          condicao_aparente: "",
          prioridade: "alta",
          estado: "em_atendimento",
          responsavel: null,
          equipe: null,
          prazo: null,
          atrasada: false,
          origem: "web",
          origem_referencia: "",
          origem_vinculo: null,
          registrada_por: { id: "u-ges", nome: "Gabriel", email: "g@itree.teste" },
          criado_em: "2026-11-01T12:00:00Z",
          transicoes_possiveis: [],
          risco_confirmado: false,
          tarefas: [
            {
              id: "tf-1",
              codigo: "TAR-000012",
              estado: "em_execucao",
              responsavel: null,
              prazo: null,
            },
          ],
        }),
      ),
      http.get(`${API}/api/v1/ocorrencias/o-1/historico`, () => HttpResponse.json([])),
    );
    await abrir("/ocorrencias/o-1");
    expect(await screen.findByRole("link", { name: "TAR-000012" })).toHaveAttribute(
      "href",
      "/equipes-tarefas/tf-1",
    );
  });
});
