import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
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
vi.mock("../paginas/visao-geral/MapaResumo", () => ({ MapaResumo: () => null }));

const API = "http://api.teste";

const PERMISSOES: Eu["permissoes"] = [
  "admin.usuarios",
  "admin.equipes",
  "admin.auditoria",
  "admin.territorios",
  "admin.configuracao",
  "mapa.ler",
  "alertas.ler",
  "inventario.ler",
  "ocorrencias.ler",
  "tarefas.ler",
];
const ADMIN: Eu = {
  id: "u-admin",
  nome: "Ana Admin",
  email: "ana@itree.teste",
  papeis: ["administrador"],
  permissoes: PERMISSOES,
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};
/** Mesmas permissões, sem o papel de administrador. */
const COORDENADOR: Eu = { ...ADMIN, papeis: ["coordenador"] };

let eu: Eu = COORDENADOR;
const vazio = { count: 0, next: null, previous: null, results: [] };

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/territorios`, () => HttpResponse.json(vazio)),
  http.get(`${API}/api/v1/especies`, () => HttpResponse.json(vazio)),
  http.get(`${API}/api/v1/tipos-ocorrencia`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/alertas/ingestoes`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/alertas/fontes`, () => HttpResponse.json([])),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
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

const CODIGO = /\b(?:DP|RN|RF|CA)-[A-Z0-9]+/;

describe("códigos internos não aparecem para o usuário final (R2-14)", () => {
  const telas: [string, string, string][] = [
    ["/administracao/territorios", "Territórios", "DP-10"],
    ["/administracao/integracoes", "Integrações", "DP-11"],
    ["/administracao/especies", "Catálogo de espécies", "DP-02"],
    ["/administracao/tipos-ocorrencia", "Tipos de ocorrência", "DP-17"],
  ];

  it.each(telas)("%s: sem código para quem não administra", async (caminho, titulo) => {
    await abrir(caminho);
    await screen.findByRole("heading", { name: titulo, level: 1 });
    await screen.findByText(/prefeitura|verificados antes do uso/);
    expect(screen.getByRole("main").textContent).not.toMatch(CODIGO);
    expect(screen.queryByText("Detalhes técnicos")).toBeNull();
  });

  it.each(telas)(
    "%s: administrador vê o código só em detalhes técnicos",
    async (caminho, titulo, codigo) => {
      eu = ADMIN;
      await abrir(caminho);
      await screen.findByRole("heading", { name: titulo, level: 1 });
      const detalhes = (await screen.findByText("Detalhes técnicos")).closest("details")!;
      expect(detalhes).toHaveTextContent(codigo);
      const resto = screen.getByRole("main").textContent!.replace(detalhes.textContent!, "");
      expect(resto).not.toMatch(CODIGO);
    },
  );

  it("a visão geral diz que os indicadores estão em definição, sem o código", async () => {
    eu = { ...COORDENADOR, permissoes: [...PERMISSOES, "relatorios.ler"] };
    servidor.use(
      http.get(`${API}/api/v1/indicadores/painel`, () =>
        HttpResponse.json({
          periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
          filtros: { bairro: null, equipe: null },
          calculado_em: "2026-10-31T12:00:00Z",
          indicadores: [],
          distribuicoes: {},
          series_mensais: { meses: [], definicao: "", series: [] },
          pendencias: [],
          equipes: [],
          atividades: [],
        }),
      ),
    );
    await abrir("/visao-geral");
    expect(
      await screen.findByText(/indicadores oficiais ainda em definição pela prefeitura/),
    ).toBeInTheDocument();
    expect(screen.getByRole("main").textContent).not.toMatch(CODIGO);
  });
});
