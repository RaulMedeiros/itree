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

const ANALISTA: Eu = {
  id: "u-ana",
  nome: "Ana Analista",
  email: "ana@itree.teste",
  papeis: ["analista_ambiental"],
  permissoes: [
    "ocorrencias.ler",
    "ocorrencias.editar",
    "inspecoes.ler",
    "alertas.ler",
    "alertas.triar",
    "relatorios.exportar",
  ],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};
let eu: Eu = ANALISTA;
let total = 230;

const pagina = (results: unknown[]) => ({
  count: total,
  next: null,
  previous: null,
  results,
});

const alerta = (n: number) => ({
  id: `al-${n}`,
  codigo: `ALR-00000${n}`,
  id_externo: `F${n}`,
  fonte: "inpe_focos",
  tipo: "foco_calor",
  area_ha: null,
  area_verde_proxima: null,
  data_deteccao: "2026-11-01T12:00:00Z",
  ingerido_em: "2026-11-01T13:00:00Z",
  bairros: [],
  arvores_proximas: 0,
  ocorrencias_proximas: 0,
  ocorrencia: null,
  status: "detectado",
});

const inspecao = (n: number) => ({
  id: `i-${n}`,
  codigo: `INS-00000${n}`,
  arvore: { id: "a", codigo: "ARV-000001", bairro: "Meireles", endereco: "" },
  tecnico: { id: "u", nome: "Téo", email: "teo@itree.teste" },
  realizada_em: "2026-11-01T12:00:00Z",
  recebida_em: "2026-11-01T13:00:00Z",
  estado: "em_revisao",
  condicao_aparente: "ruim",
  sinais: [],
  requer_encaminhamento: false,
});

const corpos: { caminho: string; corpo: unknown }[] = [];
const exportacoes: URLSearchParams[] = [];
let consultasDaOperacao = 0;

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/territorios`, () => HttpResponse.json(pagina([]))),
  http.get(`${API}/api/v1/alertas`, () => HttpResponse.json(pagina([alerta(1), alerta(2)]))),
  http.get(`${API}/api/v1/inspecoes`, () => HttpResponse.json(pagina([inspecao(1), inspecao(2)]))),
  http.get(`${API}/api/v1/relatorios/exportar`, ({ request }) => {
    exportacoes.push(new URL(request.url).searchParams);
    return new HttpResponse("a;b\n", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="itree-teste.csv"',
      },
    });
  }),
  http.post(`${API}/api/v1/alertas/lote/status`, async ({ request }) => {
    const corpo = await request.json();
    corpos.push({ caminho: "/api/v1/alertas/lote/status", corpo });
    if ("filtros" in (corpo as object)) {
      return HttpResponse.json(
        {
          id: "op-1",
          recurso: "alertas",
          acao: "status",
          estado: "pendente",
          total: 230,
          processados: 0,
          atualizadas: 0,
          falhas: 0,
          motivos: [],
          motivos_omitidos: 0,
          erro: "",
          criado_em: "2026-11-12T10:00:00Z",
          iniciada_em: null,
          concluida_em: null,
        },
        { status: 202 },
      );
    }
    return HttpResponse.json({
      atualizadas: 1,
      ignoradas: [
        {
          id: "al-2",
          codigo: "ALR-000002",
          motivo: "Não pode passar de “Em triagem” para “Em triagem”.",
        },
      ],
    });
  }),
  http.get(`${API}/api/v1/operacoes-em-lote/op-1`, () => {
    consultasDaOperacao += 1;
    const base = {
      id: "op-1",
      recurso: "alertas",
      acao: "status",
      total: 230,
      motivos_omitidos: 0,
      erro: "",
      criado_em: "2026-11-12T10:00:00Z",
      iniciada_em: "2026-11-12T10:00:01Z",
    };
    return HttpResponse.json(
      consultasDaOperacao === 1
        ? {
            ...base,
            estado: "em_andamento",
            processados: 100,
            atualizadas: 100,
            falhas: 0,
            motivos: [],
            concluida_em: null,
          }
        : {
            ...base,
            estado: "concluida",
            processados: 230,
            atualizadas: 229,
            falhas: 1,
            motivos: [{ id: "al-9", codigo: "ALR-000009", motivo: "Já foi encerrada." }],
            concluida_em: "2026-11-12T10:00:05Z",
          },
    );
  }),
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
  consultasDaOperacao = 0;
  total = 230;
  eu = ANALISTA;
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

describe("M-26: alertas, status em lote", () => {
  it("muda o status dos marcados e lista os que a transição não permitiu", async () => {
    const usuario = userEvent.setup();
    await abrir("/alertas");
    await screen.findByText("ALR-000001");
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar ALR-000001" }));
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar ALR-000002" }));
    await usuario.click(screen.getByRole("button", { name: "Alterar status" }));
    const dialogo = await screen.findByRole("dialog");
    await usuario.click(within(dialogo).getByRole("button", { name: "Alterar status" }));
    expect(await screen.findByText(/registro alterado/)).toBeInTheDocument();
    expect(screen.getByText(/Não pode passar de “Em triagem”/)).toBeInTheDocument();
    expect(corpos[0]).toEqual({
      caminho: "/api/v1/alertas/lote/status",
      corpo: { ids: ["al-1", "al-2"], status: "em_triagem" },
    });
  });

  it("exige a justificativa quando o status a pede", async () => {
    const usuario = userEvent.setup();
    await abrir("/alertas");
    await screen.findByText("ALR-000001");
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar ALR-000001" }));
    await usuario.click(screen.getByRole("button", { name: "Alterar status" }));
    const dialogo = await screen.findByRole("dialog");
    await usuario.selectOptions(within(dialogo).getByLabelText(/Novo status/), "descartado");
    const confirmar = within(dialogo).getByRole("button", { name: "Alterar status" });
    expect(confirmar).toBeDisabled();
    await usuario.type(within(dialogo).getByLabelText(/Justificativa/), "Queima autorizada");
    expect(confirmar).toBeEnabled();
  });

  it("quem não tria alertas não vê a seleção", async () => {
    eu = { ...ANALISTA, permissoes: ["alertas.ler"] };
    await abrir("/alertas");
    await screen.findByText("ALR-000001");
    expect(screen.queryByRole("checkbox", { name: /Selecionar/ })).toBeNull();
  });

  it("todos os filtrados acima de 200 mostram o progresso e depois o resultado", async () => {
    const usuario = userEvent.setup();
    await abrir("/alertas");
    await screen.findByText("ALR-000001");
    await usuario.click(
      screen.getByRole("checkbox", { name: "Selecionar todos os alertas da página" }),
    );
    await usuario.click(screen.getByRole("button", { name: "Selecionar todos os 230 filtrados" }));
    await usuario.click(screen.getByRole("button", { name: "Alterar status" }));
    const dialogo = await screen.findByRole("dialog");
    await usuario.click(within(dialogo).getByRole("button", { name: "Alterar status" }));
    expect(corpos[0]!.corpo).toMatchObject({ filtros: { status: "abertos" } });
    expect(await screen.findByText(/100 de 230 processados/, {}, { timeout: 4000 })).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Andamento da ação em lote" })).toHaveValue(100);
    expect(await screen.findByText(/229/, {}, { timeout: 4000 })).toBeVisible();
    expect(screen.getByText(/registros alterados de 230/)).toBeInTheDocument();
    expect(screen.getByText(/Já foi encerrada\./)).toBeInTheDocument();
  });
});

describe("M-26: inspeções, selecionar e exportar", () => {
  it("exporta só as marcadas, pelos ids", async () => {
    const usuario = userEvent.setup();
    await abrir("/inspecoes");
    await screen.findByText("INS-000001");
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar INS-000002" }));
    await usuario.click(screen.getByRole("button", { name: "Exportar seleção" }));
    await vi.waitFor(() => expect(exportacoes).toHaveLength(1));
    expect(Object.fromEntries(exportacoes[0]!.entries())).toMatchObject({
      conjunto: "inspecoes",
      ids: "i-2",
    });
  });

  it("com todos os filtrados exporta pelos filtros da lista, sem ids", async () => {
    const usuario = userEvent.setup();
    await abrir("/inspecoes?condicao=ruim");
    await screen.findByText("INS-000001");
    await usuario.click(
      screen.getByRole("checkbox", { name: "Selecionar todas as inspeções da página" }),
    );
    await usuario.click(screen.getByRole("button", { name: "Selecionar todos os 230 filtrados" }));
    await usuario.click(screen.getByRole("button", { name: "Exportar seleção" }));
    await vi.waitFor(() => expect(exportacoes).toHaveLength(1));
    const params = Object.fromEntries(exportacoes[0]!.entries());
    expect(params).toMatchObject({ conjunto: "inspecoes", condicao: "ruim", estado: "em_revisao" });
    expect(params).not.toHaveProperty("ids");
  });

  it("não há seleção sem permissão de exportar", async () => {
    eu = { ...ANALISTA, permissoes: ["inspecoes.ler"] };
    await abrir("/inspecoes");
    await screen.findByText("INS-000001");
    expect(screen.queryByRole("checkbox", { name: /Selecionar/ })).toBeNull();
  });
});
