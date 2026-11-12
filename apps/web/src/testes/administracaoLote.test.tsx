import { configurarCliente, type Eu, type UsuarioAdmin } from "@itree/api-client";
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

const MUNICIPIO = {
  id: "t-mun",
  nome: "Município de teste",
  tipo: "municipio",
  pai: null,
  arvores_no_escopo: 1240,
};
const BAIRRO_B = {
  id: "t-b",
  nome: "Bairro B",
  tipo: "bairro",
  pai: { id: "t-mun", nome: "Município de teste", tipo: "municipio" },
  arvores_no_escopo: 3,
};
const BAIRRO_A = { ...BAIRRO_B, id: "t-a", nome: "Bairro A", arvores_no_escopo: 0 };

const pagina = <T,>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

const servidor = criarServidor(
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
  http.get(`${API}/api/v1/alertas/fontes`, () =>
    HttpResponse.json([
      {
        fonte: "inpe_focos",
        rotulo: "INPE — BDQueimadas (focos de calor)",
        automatica: true,
        intervalo_horas: 6,
        ultima_coleta: new Date(Date.now() - 2 * 3600_000).toISOString(),
        ultima_coleta_sucesso: true,
        proxima_coleta: new Date(Date.now() + 4 * 3600_000 + 60_000).toISOString(),
      },
      {
        fonte: "inpe_deter",
        rotulo: "INPE — TerraBrasilis/DETER",
        automatica: false,
        intervalo_horas: null,
        ultima_coleta: null,
        ultima_coleta_sucesso: null,
        proxima_coleta: null,
      },
    ]),
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
        orgao: "INPE, Programa Queimadas",
        licenca:
          "Não declarada pela fonte; condições de uso em definição pela prefeitura. Citar: INPE, Programa Queimadas.",
        data_referencia: "2026-11-10",
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
  it("não expõe nome de variável de ambiente e deixa o código DP-11 só em detalhes técnicos", async () => {
    await abrir("/administracao/integracoes");
    expect(await screen.findByText("Arquivo sintético")).toBeInTheDocument();
    expect(screen.queryByText(/ALERTAS_FONTES/)).toBeNull();
    // Fora dos detalhes técnicos, nenhum texto da tela traz o código.
    const detalhes = screen.getByText("Detalhes técnicos").closest("details")!;
    expect(detalhes).toHaveTextContent("DP-11");
    expect(
      screen.getByRole("main").textContent?.replace(detalhes.textContent ?? "", ""),
    ).not.toMatch(/\bDP-\d+/);
  });

  it("mostra a última e a próxima coleta de cada fonte", async () => {
    await abrir("/administracao/integracoes");
    const fonte = async (nome: RegExp) =>
      within((await screen.findByRole("cell", { name: nome })).closest("tr")!);
    const focos = await fonte(/BDQueimadas/);
    expect(focos.getByText("há 2 horas")).toBeInTheDocument();
    expect(focos.getByText("em 4 horas")).toBeInTheDocument();
    expect(focos.getByText("A cada 6 horas")).toBeInTheDocument();
    const deter = await fonte(/DETER/);
    expect(deter.getByText("Nunca coletada")).toBeInTheDocument();
    expect(deter.getByText(/Sem coleta automática/)).toBeInTheDocument();
  });

  it("mostra órgão, licença e data de referência da fonte", async () => {
    await abrir("/administracao/integracoes");
    expect(await screen.findByText("INPE, Programa Queimadas")).toBeInTheDocument();
    expect(screen.getByText(/Não declarada pela fonte/)).toBeInTheDocument();
    expect(screen.getByText(/Dados de 10\/11\/2026/)).toBeInTheDocument();
  });
});

describe("territórios", () => {
  it("avisa que os limites não são oficiais e que a tela é somente leitura", async () => {
    await abrir("/administracao/territorios");
    expect(await screen.findByText(/não são oficiais/)).toBeInTheDocument();
    expect(screen.getByText(/depende de a prefeitura definir as fontes/)).toBeInTheDocument();
    expect(screen.getByText("Detalhes técnicos").closest("details")).toHaveTextContent("DP-10");
    expect(screen.queryByText("DP-10")).toBeNull();
  });

  it("mostra a coluna Árvores com a contagem de cada território", async () => {
    await abrir("/administracao/territorios");
    expect(await screen.findByRole("columnheader", { name: "Árvores" })).toBeInTheDocument();
    const contagem = (nome: string) =>
      within(screen.getByRole("cell", { name: nome }).closest("tr")!).getAllByRole("cell")[2]!
        .textContent;
    expect(contagem("Município de teste")).toBe("1.240");
    expect(contagem("Bairro B")).toBe("3");
    expect(contagem("Bairro A")).toBe("0");
  });
});

describe("migalhas (R2-01)", () => {
  it.each([
    ["/administracao/usuarios", "Usuários"],
    ["/administracao/territorios", "Territórios"],
    ["/administracao/integracoes", "Integrações"],
  ])("%s é lista com aba ativa e não repete a migalha", async (caminho, titulo) => {
    await abrir(caminho);
    expect(await screen.findByRole("heading", { name: titulo, level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Migalhas" })).toBeNull();
  });

  it("o detalhe mantém as migalhas, com o caminho de volta à lista", async () => {
    await abrir("/administracao/usuarios/u-tec");
    const nav = await screen.findByRole("navigation", { name: "Migalhas" });
    expect(within(nav).getByRole("link", { name: "Usuários" })).toHaveAttribute(
      "href",
      "/administracao/usuarios",
    );
  });
});
