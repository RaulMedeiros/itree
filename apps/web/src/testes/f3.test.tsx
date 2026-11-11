import { configurarCliente, type Alerta, type Eu } from "@itree/api-client";
import { ROTULOS_STATUS_ALERTA } from "@itree/domain";
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
// O mapa do detalhe não é exercitado aqui (sem WebGL no jsdom).
vi.mock("../mapa/Mapa", () => ({ Mapa: () => null }));

const API = "http://api.teste";

const ANALISTA: Eu = {
  id: "u-ana",
  nome: "Ana Analista",
  email: "ana@itree.teste",
  papeis: ["analista_ambiental"],
  permissoes: [
    "mapa.ler",
    "inventario.ler",
    "ocorrencias.ler",
    "alertas.ler",
    "alertas.triar",
    "relatorios.ler",
  ],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const ALERTA: Alerta = {
  id: "al-1",
  codigo: "ALR-000001",
  fonte: "inpe_focos",
  id_externo: "F1",
  tipo: "foco_calor",
  geometria: { type: "Point", coordinates: [-38.5, -3.7] },
  tipo_geometria: "Point",
  src_original: "EPSG:4326",
  area_ha: null,
  data_deteccao: "2026-10-30T17:20:00Z",
  ingerido_em: "2026-10-31T09:00:00Z",
  propriedades: { satelite: "AQUA_M-T" },
  url_origem: "",
  bairros: [{ id: "b", nome: "Meireles" }],
  status: "encaminhado",
  transicoes_possiveis: ["confirmado", "descartado"],
  justificativa: "",
  referencia: "SEUMA 1/2026",
  analisado_por: "Ana Analista",
  ocorrencia: null,
  arvores_proximas: 2,
  ocorrencias_proximas: 1,
  atualizado_em: "2026-10-31T10:00:00Z",
};

const triagens: unknown[] = [];
const pedidosLista: (string | null)[] = [];
const parametrosLista: URLSearchParams[] = [];
const parametrosDetalhe: URLSearchParams[] = [];
const parametrosProximas: URLSearchParams[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(ANALISTA)),
  http.get(`${API}/api/v1/territorios`, () =>
    HttpResponse.json({
      count: 2,
      next: null,
      previous: null,
      results: [
        { id: "b-1", nome: "Aldeota", tipo: "bairro" },
        { id: "b-2", nome: "Meireles", tipo: "bairro" },
      ],
    }),
  ),
  http.get(`${API}/api/v1/alertas/ingestoes`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/alertas/al-1`, ({ request }) => {
    parametrosDetalhe.push(new URL(request.url).searchParams);
    return HttpResponse.json(ALERTA);
  }),
  http.get(`${API}/api/v1/alertas/al-1/arvores-proximas`, ({ request }) => {
    parametrosProximas.push(new URL(request.url).searchParams);
    return HttpResponse.json([
      {
        id: "a-1",
        codigo: "ARV-000001",
        especie: "Oiti",
        condicao_aparente: "boa",
        distancia_m: 42.4,
      },
      { id: "a-2", codigo: "ARV-000002", especie: null, condicao_aparente: "", distancia_m: 87.6 },
    ]);
  }),
  http.get(`${API}/api/v1/alertas`, ({ request }) => {
    const { searchParams } = new URL(request.url);
    pedidosLista.push(searchParams.get("ordem"));
    parametrosLista.push(searchParams);
    return HttpResponse.json({ count: 1, next: null, previous: null, results: [ALERTA] });
  }),
  http.get(`${API}/api/v1/alertas/al-1/historico`, () => HttpResponse.json([])),
  http.post(`${API}/api/v1/alertas/al-1/triagem`, async ({ request }) => {
    triagens.push(await request.json());
    return HttpResponse.json({ ...ALERTA, status: "confirmado", transicoes_possiveis: [] });
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  triagens.length = 0;
  pedidosLista.length = 0;
  parametrosLista.length = 0;
  parametrosDetalhe.length = 0;
  parametrosProximas.length = 0;
  localStorage.clear();
});
afterAll(() => servidor.close());

describe("alertas ambientais", () => {
  it("nenhum status afirma ilegalidade antes da autoridade", () => {
    for (const rotulo of Object.values(ROTULOS_STATUS_ALERTA)) {
      expect(rotulo.toLowerCase()).not.toMatch(/ilegal|infra/);
    }
  });

  it("confirmação exige justificativa e documento da autoridade", async () => {
    const usuario = userEvent.setup();
    const { criarRoteador } = await import("../rotas");
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider
          router={criarRoteador(createMemoryHistory({ initialEntries: ["/alertas/al-1"] }))}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/não prova, por si só, ilegalidade/)).toBeInTheDocument();
    await usuario.click(
      screen.getByRole("button", { name: "Registrar confirmação da autoridade" }),
    );
    const dialogo = await screen.findByRole("dialog");
    const confirmar = within(dialogo).getByRole("button", { name: "Confirmar" });
    await usuario.type(within(dialogo).getByLabelText(/Justificativa/), "Auto de infração lavrado");
    expect(confirmar).toBeDisabled();
    await usuario.type(within(dialogo).getByLabelText(/Documento da autoridade/), "Auto 45/2026");
    await usuario.click(confirmar);
    await vi.waitFor(() =>
      expect(triagens).toEqual([
        {
          status: "confirmado",
          justificativa: "Auto de infração lavrado",
          referencia: "Auto 45/2026",
        },
      ]),
    );
  });

  it("o detalhe lista as árvores próximas com link e distância", async () => {
    const { criarRoteador } = await import("../rotas");
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider
          router={criarRoteador(createMemoryHistory({ initialEntries: ["/alertas/al-1"] }))}
        />
      </QueryClientProvider>,
    );
    const link = await screen.findByRole("link", { name: "ARV-000001" });
    expect(link).toHaveAttribute("href", "/inventario/arvores/a-1");
    expect(screen.getByText("42 m")).toBeInTheDocument();
    expect(screen.getByText("88 m")).toBeInTheDocument();
    expect(screen.getByText(/1 ocorrência aberta no mesmo raio/)).toBeInTheDocument();
  });

  it("a lista mostra as contagens e ordena por árvores próximas", async () => {
    const usuario = userEvent.setup();
    const { criarRoteador } = await import("../rotas");
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider
          router={criarRoteador(createMemoryHistory({ initialEntries: ["/alertas"] }))}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("2 árvores")).toBeInTheDocument();
    expect(screen.getByText("1 aberta a até 100 m")).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Árvores a até 100 m" }));
    await vi.waitFor(() => expect(pedidosLista).toContain("-arvores_proximas"));
  });
  it("aplica o território do cabeçalho como filtro de bairro, como nas ocorrências", async () => {
    servidor.use(
      http.get(`${API}/api/v1/eu`, () =>
        HttpResponse.json({
          ...ANALISTA,
          territorios: [
            { id: "b-1", nome: "Aldeota", tipo: "bairro" },
            { id: "b-2", nome: "Meireles", tipo: "bairro" },
          ],
        }),
      ),
    );
    localStorage.setItem("itree:territorio-ativo:u-ana", "b-2");
    const { criarRoteador } = await import("../rotas");
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider
          router={criarRoteador(createMemoryHistory({ initialEntries: ["/alertas"] }))}
        />
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(parametrosLista.at(-1)?.get("bairro")).toBe("b-2"));
    expect(await screen.findByRole("combobox", { name: "Bairro" })).toHaveValue("b-2");
  });
  it("o raio escolhido na lista vai para a API e aparece no rótulo da coluna", async () => {
    const usuario = userEvent.setup();
    const { criarRoteador } = await import("../rotas");
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider
          router={criarRoteador(createMemoryHistory({ initialEntries: ["/alertas"] }))}
        />
      </QueryClientProvider>,
    );
    const seletor = await screen.findByRole("combobox", {
      name: "Raio das árvores e ocorrências próximas",
    });
    expect(
      within(seletor)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["50 m", "100 m", "250 m", "500 m"]);
    await usuario.selectOptions(seletor, "250");
    await vi.waitFor(() => expect(parametrosLista.at(-1)?.get("raio")).toBe("250"));
    expect(await screen.findByRole("button", { name: "Árvores a até 250 m" })).toBeInTheDocument();
    expect(screen.getByText("1 aberta a até 250 m")).toBeInTheDocument();
  });

  it("o raio do detalhe vale para a contagem e para a lista de árvores", async () => {
    const usuario = userEvent.setup();
    const { criarRoteador } = await import("../rotas");
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider
          router={criarRoteador(createMemoryHistory({ initialEntries: ["/alertas/al-1"] }))}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Árvores a até 100 m" })).toBeInTheDocument();
    await usuario.selectOptions(
      screen.getByRole("combobox", { name: "Raio das árvores e ocorrências próximas" }),
      "500",
    );
    expect(await screen.findByRole("heading", { name: "Árvores a até 500 m" })).toBeInTheDocument();
    await vi.waitFor(() => expect(parametrosProximas.at(-1)?.get("raio")).toBe("500"));
    expect(parametrosDetalhe.at(-1)?.get("raio")).toBe("500");
  });
});
