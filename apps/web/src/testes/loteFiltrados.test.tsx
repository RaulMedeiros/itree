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

const consultas: URLSearchParams[] = [];
/** Total que os filtros alcançam: maior que a página, como numa lista de verdade. */
let total = 230;
const listar = (itens: unknown[]) => () =>
  HttpResponse.json({ count: total, next: null, previous: null, results: itens });

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/territorios`, () => HttpResponse.json(pagina([]))),
  http.get(`${API}/api/v1/tipos-ocorrencia`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/equipes`, () => HttpResponse.json(pagina(equipes))),
  http.get(`${API}/api/v1/usuarios`, () => HttpResponse.json(pagina([]))),
  http.get(`${API}/api/v1/ocorrencias`, ({ request }) => {
    consultas.push(new URL(request.url).searchParams);
    return listar([ocorrencia(1), ocorrencia(2), ocorrencia(3)])();
  }),
  http.get(`${API}/api/v1/tarefas`, listar([tarefa(1), tarefa(2), tarefa(3)])),
  registrar("/api/v1/ocorrencias/lote/prazo", { atualizadas: 230, ignoradas: [] }),
  registrar("/api/v1/tarefas/lote/prazo", { atualizadas: 2, ignoradas: [] }),
  registrar("/api/v1/ocorrencias/lote/prioridade", { atualizadas: 230, ignoradas: [] }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  corpos.length = 0;
  consultas.length = 0;
  total = 230;
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

describe("M-23: definir prazo em lote", () => {
  it("define o prazo das ocorrências marcadas e mostra o que falta ou o atraso", async () => {
    const usuario = userEvent.setup();
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar OCO-000001" }));
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar OCO-000002" }));
    await usuario.click(screen.getByRole("button", { name: "Definir prazo" }));
    const dialogo = await screen.findByRole("dialog");
    expect(
      within(dialogo).getByRole("heading", { name: "Definir prazo de 2 ocorrências" }),
    ).toBeInTheDocument();
    const confirmar = within(dialogo).getByRole("button", { name: "Definir prazo" });
    expect(confirmar).toBeDisabled(); // sem data e sem "remover", nada a enviar
    await usuario.type(within(dialogo).getByLabelText("Novo prazo"), "15122099");
    expect(within(dialogo).getByText(/Prazo: faltam \d+ dias\./)).toBeInTheDocument();
    await usuario.click(confirmar);
    expect(await screen.findByText(/registros alterados/)).toBeInTheDocument();
    expect(corpos).toEqual([
      {
        caminho: "/api/v1/ocorrencias/lote/prazo",
        corpo: { ids: ["o-1", "o-2"], prazo: "2099-12-15" },
      },
    ]);
  });

  it("remover o prazo envia prazo nulo", async () => {
    const usuario = userEvent.setup();
    await abrir("/equipes-tarefas");
    await screen.findByText("TAR-000001");
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar TAR-000001" }));
    await usuario.click(screen.getByRole("button", { name: "Definir prazo" }));
    const dialogo = await screen.findByRole("dialog");
    await usuario.click(within(dialogo).getByRole("checkbox", { name: "Remover o prazo" }));
    await usuario.click(within(dialogo).getByRole("button", { name: "Remover prazo" }));
    await screen.findByText(/registros alterados/);
    expect(corpos[0]).toEqual({
      caminho: "/api/v1/tarefas/lote/prazo",
      corpo: { ids: ["tf-1"], prazo: null },
    });
  });

  it("quem não edita ocorrências não vê a ação", async () => {
    const usuario = userEvent.setup();
    eu = {
      ...COORDENADOR,
      permissoes: ["ocorrencias.ler", "ocorrencias.priorizar"],
    };
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar OCO-000001" }));
    expect(screen.queryByRole("button", { name: "Definir prazo" })).toBeNull();
  });
});

describe("M-23: selecionar todos os N filtrados", () => {
  it("só oferece depois de marcar a página inteira, e conta os filtrados", async () => {
    const usuario = userEvent.setup();
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar OCO-000001" }));
    expect(screen.queryByRole("button", { name: /Selecionar todos os/ })).toBeNull();
    await usuario.click(
      screen.getByRole("checkbox", { name: "Selecionar todas as ocorrências da página" }),
    );
    await usuario.click(screen.getByRole("button", { name: "Selecionar todos os 230 filtrados" }));
    const barra = screen.getByRole("region", { name: "Ações da seleção" });
    expect(within(barra).getByText(/230 ocorrências selecionadas/)).toBeInTheDocument();
    expect(within(barra).getByText(/todos os filtrados/)).toBeInTheDocument();
  });

  it("não oferece quando os filtros alcançam só a página", async () => {
    const usuario = userEvent.setup();
    total = 3;
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    await usuario.click(
      screen.getByRole("checkbox", { name: "Selecionar todas as ocorrências da página" }),
    );
    expect(screen.queryByRole("button", { name: /Selecionar todos os/ })).toBeNull();
  });

  it("manda os filtros no lugar dos ids, com os mesmos filtros da lista", async () => {
    const usuario = userEvent.setup();
    total = 150;
    await abrir("/ocorrencias?prioridade=alta");
    await screen.findByText("OCO-000001");
    await usuario.click(
      screen.getByRole("checkbox", { name: "Selecionar todas as ocorrências da página" }),
    );
    await usuario.click(screen.getByRole("button", { name: "Selecionar todos os 150 filtrados" }));
    await usuario.click(screen.getByRole("button", { name: "Alterar prioridade" }));
    const dialogo = await screen.findByRole("dialog");
    expect(
      within(dialogo).getByRole("heading", { name: "Alterar prioridade de 150 ocorrências" }),
    ).toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole("button", { name: "Alterar prioridade" }));
    await screen.findByText(/registros alterados/);
    expect(corpos[0]).toEqual({
      caminho: "/api/v1/ocorrencias/lote/prioridade",
      corpo: { filtros: { prioridade: "alta", estado: "abertas" }, prioridade: "media" },
    });
  });

  it("desmarcar uma linha volta a seleção para as marcadas", async () => {
    const usuario = userEvent.setup();
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    await usuario.click(
      screen.getByRole("checkbox", { name: "Selecionar todas as ocorrências da página" }),
    );
    await usuario.click(screen.getByRole("button", { name: "Selecionar todos os 230 filtrados" }));
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar OCO-000002" }));
    const barra = screen.getByRole("region", { name: "Ações da seleção" });
    expect(within(barra).getByText("2 ocorrências selecionadas")).toBeInTheDocument();
    expect(within(barra).queryByText(/todos os filtrados/)).toBeNull();
  });

  it("acima de 200 avisa para refinar os filtros e bloqueia as ações", async () => {
    const usuario = userEvent.setup();
    total = 230;
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    await usuario.click(
      screen.getByRole("checkbox", { name: "Selecionar todas as ocorrências da página" }),
    );
    await usuario.click(screen.getByRole("button", { name: "Selecionar todos os 230 filtrados" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Os filtros alcançam 230 registros; o limite é de 200 por ação. Refine os filtros para continuar.",
    );
    expect(screen.getByRole("button", { name: "Definir prazo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reatribuir" })).toBeDisabled();
  });

  it("nas tarefas, define o prazo de todas as filtradas", async () => {
    const usuario = userEvent.setup();
    total = 120;
    await abrir("/equipes-tarefas?responsavel=eu");
    await screen.findByText("TAR-000001");
    await usuario.click(
      screen.getByRole("checkbox", { name: /Selecionar todas as tarefas da página/ }),
    );
    await usuario.click(screen.getByRole("button", { name: "Selecionar todos os 120 filtrados" }));
    await usuario.click(screen.getByRole("button", { name: "Definir prazo" }));
    const dialogo = await screen.findByRole("dialog");
    await usuario.type(within(dialogo).getByLabelText("Novo prazo"), "20122099");
    await usuario.click(within(dialogo).getByRole("button", { name: "Definir prazo" }));
    await screen.findByText(/registros alterados/);
    expect(corpos[0]).toEqual({
      caminho: "/api/v1/tarefas/lote/prazo",
      corpo: { filtros: { responsavel: "eu", estado: "abertas" }, prazo: "2099-12-20" },
    });
  });
});
