import { configurarCliente, type Eu, type Inspecao } from "@itree/api-client";
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
vi.mock("maplibre-gl", () => ({ default: {} }));

const API = "http://api.teste";

const REVISORA: Eu = {
  id: "u-rev",
  nome: "Rita Revisora",
  email: "rita@itree.teste",
  papeis: ["revisor"],
  permissoes: [
    "mapa.ler",
    "inventario.ler",
    "inspecoes.ler",
    "inspecoes.validar",
    "relatorios.ler",
  ],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const INSPECAO: Inspecao = {
  id: "i-1",
  codigo: "INS-000003",
  arvore: {
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
  },
  tecnico: { id: "u-tec", nome: "Tiago Técnico", email: "t@itree.teste" },
  realizada_em: "2026-10-30T13:00:00Z",
  recebida_em: "2026-10-30T15:00:00Z",
  estado: "em_revisao",
  condicao_aparente: "ruim",
  sinais: ["fungos", "cavidade"],
  especie: { id: "e-1", nome_cientifico: "Licania tomentosa", nomes_comuns: ["Oiti"] },
  especie_texto: "",
  requer_encaminhamento: true,
  origem: "app",
  revisor: null,
  validada_em: null,
  versao: 1,
  localizacao: { longitude: -38.50001, latitude: -3.70001 },
  precisao_m: 3,
  arvore_confirmada: true,
  observacoes: "Base do tronco com cavidade.",
  motivo_devolucao: "",
  aplicado_ao_cadastro: [],
  dispositivo: "android-1",
  medidas: [],
  anterior: null,
  tarefa: null,
};

const validacoes: unknown[] = [];

const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(REVISORA)),
  http.get(`${API}/api/v1/inspecoes/i-1`, () => HttpResponse.json(INSPECAO)),
  http.get(`${API}/api/v1/inspecoes/i-1/historico`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/evidencias`, () => HttpResponse.json([])),
  http.post(`${API}/api/v1/inspecoes/i-1/validar`, async ({ request }) => {
    validacoes.push(await request.json());
    return HttpResponse.json({ ...INSPECAO, estado: "validada" });
  }),
  http.get(`${API}/api/v1/territorios`, () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  http.get(`${API}/api/v1/indicadores/painel`, () =>
    HttpResponse.json({
      periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
      filtros: { bairro: null, equipe: null },
      calculado_em: "2026-10-31T12:00:00Z",
      indicadores: [
        {
          id: "arvores_validas",
          nome: "Árvores com registro válido",
          definicao: "d",
          formula: "f",
          valor: 0,
          base: null,
          unidade: "",
          periodo: "instantâneo",
          fonte: "Registros da plataforma",
          link: null,
        },
        {
          id: "especie_confirmada",
          nome: "Espécie confirmada",
          definicao: "d",
          formula: "f",
          valor: null,
          base: 0,
          unidade: "%",
          periodo: "instantâneo",
          fonte: "Registros da plataforma",
          link: null,
        },
      ],
      distribuicoes: {},
      equipes: [],
      atividades: [],
    }),
  ),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  validacoes.length = 0;
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

describe("revisão de inspeção", () => {
  it("mostra sinais como possíveis e valida só o que foi marcado", async () => {
    const usuario = userEvent.setup();
    await abrir("/inspecoes/i-1");
    expect(await screen.findByText("Presença aparente de fungos")).toBeInTheDocument();
    expect(screen.getByText(/não são diagnóstico/)).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Validar…" }));
    const dialogo = await screen.findByRole("dialog");
    // Localização não vem marcada por padrão; desmarcamos também a espécie.
    expect(within(dialogo).getByRole("checkbox", { name: /Localização GPS/ })).not.toBeChecked();
    await usuario.click(within(dialogo).getByRole("checkbox", { name: /Espécie/ }));
    await usuario.click(within(dialogo).getByRole("button", { name: "Validar" }));
    await vi.waitFor(() =>
      expect(validacoes).toEqual([{ aplicar: ["condicao_aparente"], motivo: "" }]),
    );
  });
});

describe("visão geral", () => {
  it("indicador sem base aparece como “Sem dados”, não como zero", async () => {
    await abrir("/visao-geral");
    const cartao = (await screen.findByText("Espécie confirmada")).closest("div")!.parentElement!;
    expect(within(cartao).getByText("Sem dados")).toBeInTheDocument();
    const validas = screen.getByText("Árvores com registro válido").closest("div")!.parentElement!;
    expect(within(validas).getByText("0")).toBeInTheDocument();
  });
});
