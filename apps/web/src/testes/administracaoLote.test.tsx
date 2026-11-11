import { configurarCliente, type Eu, type UsuarioAdmin } from "@itree/api-client";
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
    activeNavigator: undefined,
    error: undefined,
    signinRedirect: vi.fn(),
    signoutRedirect: vi.fn(),
  }),
  hasAuthParams: () => false,
}));
vi.mock("../autenticacao/gerenciador", () => ({ gerenciadorUsuario: {} }));

const API = "http://api.teste";

const ADMIN: Eu = {
  id: "u-admin",
  nome: "Ana Admin",
  email: "ana@itree.teste",
  papeis: ["administrador"],
  permissoes: [
    "admin.usuarios",
    "admin.equipes",
    "admin.auditoria",
    "admin.territorios",
    "admin.configuracao",
    "mapa.ler",
  ],
  territorios: [{ id: "t-mun", nome: "Município de teste", tipo: "municipio" }],
  ambiente: "desenvolvimento",
} as Eu;

const TECNICO: UsuarioAdmin = {
  id: "u-tec",
  nome: "Tadeu Técnico",
  email: "tadeu@itree.teste",
  papeis: ["tecnico"],
  registro_profissional: "",
  ativo: true,
  territorios: [],
  equipes: [],
  vinculado: false,
  date_joined: "2026-10-01T12:00:00Z",
  last_login: null,
};

const MUNICIPIO = { id: "t-mun", nome: "Município de teste", tipo: "municipio", pai: null };
const BAIRRO_B = {
  id: "t-b",
  nome: "Bairro B",
  tipo: "bairro",
  pai: { id: "t-mun", nome: "Município de teste", tipo: "municipio" },
};
const BAIRRO_A = { ...BAIRRO_B, id: "t-a", nome: "Bairro A" };

const pagina = <T,>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(ADMIN)),
  http.get(`${API}/api/v1/admin/usuarios`, () =>
    HttpResponse.json(
      pagina([TECNICO, { ...TECNICO, id: "u-des", nome: "Dora", ativo: false, vinculado: true }]),
    ),
  ),
  http.get(`${API}/api/v1/admin/usuarios/u-tec`, () => HttpResponse.json(TECNICO)),
  http.get(`${API}/api/v1/territorios`, () =>
    HttpResponse.json(pagina([BAIRRO_B, MUNICIPIO, BAIRRO_A])),
  ),
  http.get(`${API}/api/v1/alertas/ingestoes`, () =>
    HttpResponse.json([
      {
        id: 1,
        fonte: "inpe_focos",
        origem: "arquivo sintético",
        iniciada_em: "2026-11-01T12:00:00Z",
        concluida_em: "2026-11-01T12:00:01Z",
        sucesso: true,
        recebidos: 1,
        novos: 1,
        ja_existentes: 0,
        fora_do_municipio: 0,
        invalidos: 0,
        erro: "",
        usuario: null,
      },
    ]),
  ),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => servidor.resetHandlers());
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

describe("lista de usuários", () => {
  it("mostra um único estado por usuário", async () => {
    await abrir("/administracao/usuarios");
    const tabela = await screen.findByRole("table");
    await within(tabela).findByText("Tadeu Técnico");
    expect(within(tabela).getByText("Aguardando primeiro acesso")).toBeInTheDocument();
    expect(within(tabela).queryByText("Ativo")).toBeNull();
    expect(within(tabela).getByText("Desativado")).toBeInTheDocument();
  });
});

describe("detalhe do usuário", () => {
  it("avisa 'Sem alterações' e só pede registro profissional para revisor", async () => {
    const usuario = userEvent.setup();
    await abrir("/administracao/usuarios/u-tec");
    expect(await screen.findByText("Sem alterações")).toBeInTheDocument();
    expect(screen.queryByText(/Necessário, junto do papel de revisor/)).toBeNull();
    await usuario.click(screen.getByRole("checkbox", { name: /Técnico revisor/ }));
    expect(screen.getByText(/Necessário, junto do papel de revisor/)).toBeInTheDocument();
    expect(screen.queryByText("Sem alterações")).toBeNull();
  });

  it("mostra bairros sob o município e avisa quando o município está marcado", async () => {
    const usuario = userEvent.setup();
    await abrir("/administracao/usuarios/u-tec");
    const marcas = await screen.findAllByRole("checkbox", { name: /Município de teste|Bairro/ });
    const nomes = marcas.map((m) => m.closest("label")?.querySelector("span span")?.textContent);
    expect(nomes).toEqual(["Município de teste", "Bairro A", "Bairro B"]);
    expect(screen.queryByText(/Já coberto pelo território superior/)).toBeNull();
    await usuario.click(marcas[0]!);
    expect(screen.getAllByText(/Já coberto pelo território superior/)).toHaveLength(2);
  });
});

describe("integrações", () => {
  it("não expõe nome de variável de ambiente e mantém DP-11 inteiro", async () => {
    await abrir("/administracao/integracoes");
    expect(await screen.findByText("Arquivo sintético")).toBeInTheDocument();
    expect(screen.queryByText(/ALERTAS_FONTES/)).toBeNull();
    expect(screen.getByText("DP-11")).toHaveClass("whitespace-nowrap");
  });
});

describe("territórios", () => {
  it("avisa que os limites não são oficiais e que a tela é somente leitura", async () => {
    await abrir("/administracao/territorios");
    expect(await screen.findByText(/não são oficiais/)).toBeInTheDocument();
    expect(screen.getByText("DP-10")).toHaveClass("whitespace-nowrap");
  });
});
