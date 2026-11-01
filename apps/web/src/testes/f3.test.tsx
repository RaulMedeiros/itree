import { configurarCliente, type Alerta, type Eu } from "@itree/api-client";
import { ROTULOS_STATUS_ALERTA } from "@itree/domain";
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
  atualizado_em: "2026-10-31T10:00:00Z",
};

const triagens: unknown[] = [];

const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(ANALISTA)),
  http.get(`${API}/api/v1/alertas/al-1`, () => HttpResponse.json(ALERTA)),
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
});
