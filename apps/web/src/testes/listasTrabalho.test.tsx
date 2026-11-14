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

const exportacoes: URLSearchParams[] = [];
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
  http.get(`${API}/api/v1/inspecoes`, () => HttpResponse.json(pagina([]))),
  http.get(`${API}/api/v1/alertas`, () => HttpResponse.json(pagina([]))),
  http.get(`${API}/api/v1/relatorios/exportar`, ({ request }) => {
    exportacoes.push(new URL(request.url).searchParams);
    return new HttpResponse("a;b\n", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="itree-teste.csv"',
      },
    });
  }),
  registrar("/api/v1/ocorrencias/lote/prioridade", { atualizadas: 2, ignoradas: [] }),
  registrar("/api/v1/ocorrencias/lote/reatribuir", {
    atualizadas: 1,
    ignoradas: [{ id: "o-2", codigo: "OCO-000002", motivo: "Já foi encerrada." }],
  }),
  registrar("/api/v1/tarefas/lote/equipe", { atualizadas: 2, ignoradas: [] }),
);

beforeAll(() => {
  URL.createObjectURL = () => "blob:teste";
  URL.revokeObjectURL = () => undefined;
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  corpos.length = 0;
  exportacoes.length = 0;
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

describe("G-08: Exportar CSV nas listas", () => {
  it.each([
    ["/ocorrencias", "ocorrencias", { estado: "abertas" }],
    [
      "/ocorrencias?prioridade=alta&atrasadas=true",
      "ocorrencias",
      { prioridade: "alta", atrasadas: "true", estado: "abertas" },
    ],
    ["/inspecoes?condicao=ruim", "inspecoes", { condicao: "ruim", estado: "em_revisao" }],
    ["/equipes-tarefas?atrasadas=true", "tarefas", { atrasadas: "true", estado: "abertas" }],
    ["/alertas?fonte=inpe_focos", "alertas", { fonte: "inpe_focos", status: "abertos" }],
  ])("%s exporta o conjunto com os filtros atuais", async (caminho, conjunto, esperados) => {
    const usuario = userEvent.setup();
    await abrir(caminho);
    await usuario.click(await screen.findByRole("button", { name: "Exportar CSV" }));
    await vi.waitFor(() => expect(exportacoes).toHaveLength(1));
    const params = Object.fromEntries(exportacoes[0]!.entries());
    expect(params).toMatchObject({ conjunto, formato: "csv", ...esperados });
    expect(params).not.toHaveProperty("pagina");
    expect(params).not.toHaveProperty("tamanho");
  });

  it("não aparece sem a permissão de exportar", async () => {
    eu = {
      ...COORDENADOR,
      permissoes: COORDENADOR.permissoes.filter((p) => p !== "relatorios.exportar"),
    };
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    expect(screen.queryByRole("button", { name: "Exportar CSV" })).toBeNull();
  });
});

describe("R2-15: códigos sem quebra de linha", () => {
  it("alertas e ocorrências mantêm o código e o ID externo em uma linha", async () => {
    servidor.use(
      http.get(`${API}/api/v1/alertas`, () =>
        HttpResponse.json(
          pagina([
            {
              id: "al-1",
              codigo: "ALR-000002",
              id_externo: "SINT-DETER-1",
              fonte: "inpe_deter",
              tipo: "supressao",
              area_ha: null,
              data_deteccao: "2026-10-30T12:00:00Z",
              ingerido_em: "2026-10-31T12:00:00Z",
              bairros: [],
              arvores_proximas: 0,
              ocorrencias_proximas: 0,
              ocorrencia: null,
              area_verde_proxima: null,
              status: "detectado",
            },
          ]),
        ),
      ),
    );
    await abrir("/alertas");
    expect(await screen.findByRole("link", { name: "ALR-000002" })).toHaveClass(
      "whitespace-nowrap",
    );
    expect(screen.getByText("SINT-DETER-1")).toHaveClass("whitespace-nowrap");
  });

  it("o código da ocorrência não quebra", async () => {
    await abrir("/ocorrencias");
    expect(await screen.findByRole("link", { name: "OCO-000001" })).toHaveClass(
      "whitespace-nowrap",
    );
  });
});

describe("R3-30 e R3-09: ocorrências, uma linha de filtros e um só aviso de atraso", () => {
  it("a ocorrência atrasada traz um único selo com os dias, sem repetir em texto vermelho", async () => {
    servidor.use(
      http.get(`${API}/api/v1/ocorrencias`, () =>
        HttpResponse.json(
          pagina([ocorrencia(1, { atrasada: true, prazo: "2020-01-01", prioridade: "alta" })]),
        ),
      ),
    );
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    expect(screen.getByText(/^Atrasada há \d+ dias$/)).toBeInTheDocument();
    expect(screen.queryByText(/^atrasado há/)).toBeNull();
  });

  it('"Sem prioridade" é texto suave, não selo', async () => {
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    const texto = screen.getAllByText("Sem prioridade")[0]!;
    expect(texto).toHaveClass("text-texto-suave");
    expect(texto.className).not.toMatch(/\bbg-/);
    expect(screen.queryByText("Sem prioridade definida", { selector: "span" })).toBeNull();
  });

  it("o estado se chama 'Em aberto' e os filtros secundários ficam em Mais filtros", async () => {
    await abrir("/ocorrencias");
    await screen.findByText("OCO-000001");
    expect(within(screen.getByLabelText("Estado")).getByRole("option", { name: "Em aberto" }));
    const extras = screen.getByText("Mais filtros").closest("details")!;
    for (const rotulo of ["Bairro", "Equipe", "Só atrasadas"])
      expect(extras).toContainElement(screen.getByLabelText(rotulo));
    for (const rotulo of ["Buscar", "Estado", "Tipo", "Prioridade"])
      expect(extras).not.toContainElement(screen.getByLabelText(rotulo));
  });

  it("as abas de seção ficam acima do título, como no Inventário", async () => {
    await abrir("/ocorrencias");
    const titulo = await screen.findByRole("heading", { name: "Ocorrências", level: 1 });
    const abas = screen.getByRole("navigation", { name: "Ocorrências e alertas" });
    expect(abas.compareDocumentPosition(titulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(abas).getByRole("link", { name: "Alertas ambientais" })).toBeInTheDocument();
  });
});

describe("R3-11: ação da linha nas tarefas", () => {
  it("é secundária e de largura fixa, para o verde ficar com a ação da página", async () => {
    await abrir("/equipes-tarefas");
    const botoes = await screen.findAllByRole("button", { name: "Iniciar" });
    for (const b of botoes) {
      expect(b).toHaveClass("w-28");
      expect(b.className).not.toMatch(/\bbg-marca\b/);
      expect(b).toHaveClass("border");
    }
  });
});
