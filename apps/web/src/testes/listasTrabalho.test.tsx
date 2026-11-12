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

const COORDENADOR: Eu = {
  id: "u-coord",
  nome: "Cora Coordenadora",
  email: "cora@itree.teste",
  papeis: ["coordenador"],
  permissoes: [
    "ocorrencias.ler",
    "ocorrencias.editar",
    "ocorrencias.priorizar",
    "tarefas.ler",
    "tarefas.editar",
    "inspecoes.ler",
    "inventario.ler",
    "alertas.ler",
    "relatorios.exportar",
  ],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

let eu: Eu = COORDENADOR;

const pagina = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

const ocorrencia = (n: number, extras: Record<string, unknown> = {}) => ({
  id: `o-${n}`,
  codigo: `OCO-00000${n}`,
  tipo: { id: "ti", nome: "Poda solicitada" },
  arvore: null,
  endereco: "Rua das Mangueiras, 600",
  bairro: { id: "b", nome: "Meireles" },
  descricao: "Galho sobre a fiação",
  estado: "aberta",
  prioridade: "",
  risco_confirmado: false,
  responsavel: null,
  equipe: null,
  prazo: null,
  atrasada: false,
  criado_em: "2026-11-01T12:00:00Z",
  ...extras,
});

const tarefa = (n: number) => ({
  id: `tf-${n}`,
  codigo: `TAR-00000${n}`,
  tipo: "inspecao_arvore",
  descricao: "",
  alvo: { tipo: "arvore", id: "a-1", codigo: "ARV-000237" },
  responsavel: null,
  equipe: null,
  prazo: null,
  atrasada: false,
  estado: "nao_iniciada",
  motivo_estado: "",
  transicoes_possiveis: ["em_execucao", "cancelada"],
});

const equipes = [
  {
    id: "e-1",
    nome: "Equipe Leste",
    descricao: "",
    ativa: true,
    coordenador: null,
    membros: [],
    territorios: [],
  },
];

const corpos: { caminho: string; corpo: unknown }[] = [];
const registrar = (caminho: string, resultado: Record<string, unknown>) =>
  http.post(`${API}${caminho}`, async ({ request }) => {
    corpos.push({ caminho, corpo: await request.json() });
    return HttpResponse.json(resultado);
  });

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/territorios`, () => HttpResponse.json(pagina([]))),
  http.get(`${API}/api/v1/tipos-ocorrencia`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/equipes`, () => HttpResponse.json(pagina(equipes))),
  http.get(`${API}/api/v1/usuarios`, () => HttpResponse.json(pagina([]))),
  http.get(`${API}/api/v1/ocorrencias`, () =>
    HttpResponse.json(pagina([ocorrencia(1), ocorrencia(2), ocorrencia(3)])),
  ),
  http.get(`${API}/api/v1/tarefas`, () =>
    HttpResponse.json(pagina([tarefa(1), tarefa(2), tarefa(3)])),
  ),
  registrar("/api/v1/ocorrencias/lote/prioridade", { atualizadas: 2, ignoradas: [] }),
  registrar("/api/v1/ocorrencias/lote/reatribuir", {
    atualizadas: 1,
    ignoradas: [{ id: "o-2", codigo: "OCO-000002", motivo: "Já foi encerrada." }],
  }),
  registrar("/api/v1/tarefas/lote/equipe", { atualizadas: 2, ignoradas: [] }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  corpos.length = 0;
  eu = COORDENADOR;
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

describe("G-07: ações em lote nas ocorrências", () => {
  it("marcar linhas mostra a contagem e altera a prioridade só das marcadas", async () => {
    const usuario = userEvent.setup();
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    expect(screen.queryByRole("region", { name: "Ações da seleção" })).toBeNull();
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar OCO-000001" }));
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar OCO-000003" }));
    const barra = screen.getByRole("region", { name: "Ações da seleção" });
    expect(within(barra).getByText("2 ocorrências selecionadas")).toBeInTheDocument();
    await usuario.click(within(barra).getByRole("button", { name: "Alterar prioridade" }));
    const dialogo = await screen.findByRole("dialog");
    await usuario.selectOptions(within(dialogo).getByLabelText("Prioridade"), "urgente");
    await usuario.click(within(dialogo).getByRole("button", { name: "Alterar prioridade" }));
    expect(await screen.findByText(/registros alterados/)).toBeInTheDocument();
    expect(corpos).toEqual([
      {
        caminho: "/api/v1/ocorrencias/lote/prioridade",
        corpo: { ids: ["o-1", "o-3"], prioridade: "urgente" },
      },
    ]);
  });

  it("reatribuir manda só o que foi escolhido e mostra o motivo de cada ignorada", async () => {
    const usuario = userEvent.setup();
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    await usuario.click(
      screen.getByRole("checkbox", { name: "Selecionar todas as ocorrências da página" }),
    );
    await usuario.click(screen.getByRole("button", { name: "Reatribuir" }));
    const dialogo = await screen.findByRole("dialog");
    const confirmar = within(dialogo).getByRole("button", { name: "Reatribuir" });
    expect(confirmar).toBeDisabled(); // nada escolhido: nada a enviar
    await usuario.selectOptions(await within(dialogo).findByLabelText("Equipe"), "e-1");
    await usuario.click(confirmar);
    expect(await screen.findByText("Já foi encerrada.")).toBeInTheDocument();
    expect(screen.getByText("OCO-000002:")).toBeInTheDocument();
    expect(corpos[0]).toEqual({
      caminho: "/api/v1/ocorrencias/lote/reatribuir",
      corpo: { ids: ["o-1", "o-2", "o-3"], equipe_id: "e-1" },
    });
  });

  it("respeita as permissões: sem priorizar não há prioridade; sem editar não há seleção", async () => {
    const usuario = userEvent.setup();
    eu = {
      ...COORDENADOR,
      permissoes: COORDENADOR.permissoes.filter((p) => p !== "ocorrencias.priorizar"),
    };
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar OCO-000001" }));
    const barra = screen.getByRole("region", { name: "Ações da seleção" });
    expect(within(barra).getByRole("button", { name: "Reatribuir" })).toBeInTheDocument();
    expect(within(barra).queryByRole("button", { name: "Alterar prioridade" })).toBeNull();
  });

  it("quem só lê não vê caixas de seleção", async () => {
    eu = { ...COORDENADOR, permissoes: ["ocorrencias.ler"] };
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    expect(screen.queryByRole("checkbox", { name: /Selecionar/ })).toBeNull();
  });
});

describe("G-07: ações em lote nas tarefas", () => {
  it("reatribui a equipe das tarefas marcadas", async () => {
    const usuario = userEvent.setup();
    await abrir("/equipes-tarefas");
    await screen.findByText("TAR-000001");
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar TAR-000002" }));
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar TAR-000003" }));
    const barra = screen.getByRole("region", { name: "Ações da seleção" });
    expect(within(barra).getByText("2 tarefas selecionadas")).toBeInTheDocument();
    await usuario.click(within(barra).getByRole("button", { name: "Reatribuir equipe" }));
    const dialogo = await screen.findByRole("dialog");
    const confirmar = within(dialogo).getByRole("button", { name: "Reatribuir equipe" });
    expect(confirmar).toBeDisabled();
    await usuario.selectOptions(await within(dialogo).findByLabelText(/Nova equipe/), "e-1");
    await usuario.click(confirmar);
    expect(await screen.findByText(/registros alterados/)).toBeInTheDocument();
    expect(corpos[0]).toEqual({
      caminho: "/api/v1/tarefas/lote/equipe",
      corpo: { ids: ["tf-2", "tf-3"], equipe_id: "e-1" },
    });
  });

  it("sem permissão de editar tarefas não há seleção em lote", async () => {
    eu = { ...COORDENADOR, permissoes: ["tarefas.ler"] };
    await abrir("/equipes-tarefas");
    await screen.findByText("TAR-000001");
    expect(screen.queryByRole("checkbox", { name: /Selecionar/ })).toBeNull();
  });
});
