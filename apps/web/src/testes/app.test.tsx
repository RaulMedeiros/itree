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
    "mapa.ler",
  ],
  territorios: [{ id: "t-for", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const CARLOS: UsuarioAdmin = {
  id: "u-carlos",
  nome: "Carlos",
  email: "carlos@itree.teste",
  papeis: ["consulta"],
  registro_profissional: "",
  ativo: true,
  territorios: [],
  equipes: [],
  vinculado: true,
  date_joined: "2026-10-01T12:00:00Z",
  last_login: null,
};

const pagina = <T,>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

let eu: Eu = ADMIN;
let carlos: UsuarioAdmin = CARLOS;
const patches: unknown[] = [];

const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/admin/usuarios`, () => HttpResponse.json(pagina([carlos]))),
  http.get(`${API}/api/v1/admin/usuarios/u-carlos`, () => HttpResponse.json(carlos)),
  http.patch(`${API}/api/v1/admin/usuarios/u-carlos`, async ({ request }) => {
    const corpo = (await request.json()) as Record<string, unknown>;
    patches.push(corpo);
    const { papeis, nome, registro_profissional, ativo } = corpo as Partial<UsuarioAdmin>;
    carlos = { ...carlos, papeis, nome, registro_profissional, ativo };
    return HttpResponse.json(carlos);
  }),
  http.get(`${API}/api/v1/territorios`, () => HttpResponse.json(pagina([]))),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "token-teste" });
});
afterEach(() => {
  servidor.resetHandlers();
  eu = ADMIN;
  carlos = CARLOS;
  patches.length = 0;
});
afterAll(() => servidor.close());

async function abrir(caminho: string) {
  const { criarRoteador } = await import("../rotas");
  const roteador = criarRoteador(createMemoryHistory({ initialEntries: [caminho] }));
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <RouterProvider router={roteador} />
    </QueryClientProvider>,
  );
}

describe("controle de acesso na interface", () => {
  it("usuário sem papéis vê que o acesso aguarda liberação", async () => {
    eu = { ...ADMIN, papeis: [], permissoes: [] };
    await abrir("/");
    expect(await screen.findByText("Seu acesso aguarda liberação")).toBeInTheDocument();
  });

  it("usuário sem permissão de administração não vê o módulo e é barrado pela URL", async () => {
    eu = { ...ADMIN, papeis: ["gestor"], permissoes: ["mapa.ler", "inventario.ler"] };
    await abrir("/administracao/usuarios");
    expect(
      await screen.findByText("Você não tem permissão para acessar esta área"),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Navegação principal" });
    expect(within(nav).queryByText("Administração")).not.toBeInTheDocument();
  });
});

describe("administração de usuários", () => {
  it("lista usuários com papéis e último acesso", async () => {
    await abrir("/administracao/usuarios");
    expect(await screen.findByRole("link", { name: "Carlos" })).toBeInTheDocument();
    const tabela = screen.getByRole("table");
    expect(within(tabela).getByText("Consulta")).toBeInTheDocument();
    expect(within(tabela).getByText("Nunca")).toBeInTheDocument();
  });

  it("mudança de papel exige justificativa e a envia para a auditoria", async () => {
    const usuario = userEvent.setup();
    await abrir("/administracao/usuarios/u-carlos");
    await usuario.click(await screen.findByRole("checkbox", { name: /Gestor municipal/ }));
    await usuario.click(screen.getByRole("button", { name: "Salvar alterações" }));

    const dialogo = await screen.findByRole("dialog", { name: "Confirmar alteração de acesso" });
    const confirmar = within(dialogo).getByRole("button", { name: "Confirmar" });
    expect(confirmar).toBeDisabled();

    await usuario.type(within(dialogo).getByLabelText(/Justificativa/), "Portaria 123/2026");
    await usuario.click(confirmar);

    expect(
      await screen.findByText("Alterações salvas e registradas na auditoria."),
    ).toBeInTheDocument();
    expect(patches).toEqual([
      expect.objectContaining({ papeis: ["consulta", "gestor"], motivo: "Portaria 123/2026" }),
    ]);
  });
});
