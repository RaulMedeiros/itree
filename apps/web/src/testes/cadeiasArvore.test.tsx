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
vi.mock("../mapa/Mapa", async () => ({
  Mapa: (await import("./MapaFalsoComponente")).MapaFalsoComponente,
}));

const API = "http://api.teste";

const COMPLETO: Eu = {
  id: "u-1",
  nome: "Rita Revisora",
  email: "rita@itree.teste",
  papeis: ["gestor"],
  permissoes: ["inventario.ler", "inspecoes.ler", "ocorrencias.ler", "tarefas.ler"],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const pagina = <T,>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

const arvore = {
  id: "a-1",
  codigo: "ARV-000001",
  especie: null,
  especie_estado: "informada",
  especie_texto_original: "Oiti",
  localizacao: { longitude: -38.54, latitude: -3.74 },
  localizacao_origem: "importada",
  precisao_m: null,
  endereco: "Rua 1",
  bairro: null,
  situacao: "ativa",
  valida: true,
  origem_registro: "importacao",
  ocorrencias_abertas: 1,
  condicao_aparente: "ruim",
  criado_em: "2026-10-31T12:00:00Z",
  atualizado_em: "2026-10-31T12:00:00Z",
  identificadores: [],
  medidas_atuais: [],
  observacoes: "",
  criado_por_nome: "Rita",
  motivo_situacao: "",
  em_area_verde: null,
};

const tecnico = { id: "u-tec", nome: "Tiago Técnico", email: "t@itree.teste" };
const inspecao = (
  id: string,
  codigo: string,
  realizada_em: string,
  tarefa: { id: string; codigo: string; estado: string } | null = null,
) => ({
  id,
  codigo,
  arvore: { id: "a-1", codigo: "ARV-000001" },
  tecnico,
  realizada_em,
  recebida_em: realizada_em,
  estado: "validada",
  condicao_aparente: "ruim",
  sinais: [],
  especie: null,
  requer_encaminhamento: true,
  origem: "app",
  revisor: null,
  tarefa,
  medidas_propostas: [],
});
const ocorrencia = {
  id: "o-1",
  codigo: "OCO-000007",
  tipo: { id: "tp", nome: "Galho caído", descricao: "", prazo_padrao_dias: 3, ativo: true },
  estado: "em_atendimento",
  prioridade: "alta",
  atrasada: false,
  criado_em: "2026-10-02T12:00:00Z",
  origem_vinculo: { tipo: "inspecao", id: "i-1", codigo: "INS-000001" },
  tarefas: [
    {
      id: "tf-1",
      codigo: "TAR-000012",
      estado: "em_execucao",
      responsavel: "Tiago Técnico",
      prazo: "2099-01-10",
    },
    {
      id: "tf-2",
      codigo: "TAR-000013",
      estado: "concluida",
      responsavel: null,
      prazo: "2020-01-10",
    },
  ],
};
const avulsa = {
  ...ocorrencia,
  id: "o-2",
  codigo: "OCO-000009",
  estado: "aberta",
  origem_vinculo: null,
  criado_em: "2026-10-20T12:00:00Z",
  tarefas: [],
};

let eu: Eu = COMPLETO;
const consultas: URL[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/arvores/a-1`, () => HttpResponse.json(arvore)),
  http.get(`${API}/api/v1/arvores/a-1/historico`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/evidencias`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/inspecoes`, ({ request }) => {
    consultas.push(new URL(request.url));
    return HttpResponse.json(
      pagina([
        inspecao("i-1", "INS-000001", "2026-10-01T12:00:00Z", {
          id: "tf-0",
          codigo: "TAR-000005",
          estado: "concluida",
        }),
        inspecao("i-0", "INS-000000", "2026-08-01T12:00:00Z"),
      ]),
    );
  }),
  http.get(`${API}/api/v1/ocorrencias`, ({ request }) => {
    consultas.push(new URL(request.url));
    return HttpResponse.json(pagina([ocorrencia, avulsa]));
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  eu = COMPLETO;
  consultas.length = 0;
});
afterAll(() => servidor.close());

async function abrirCadeias() {
  const { criarRoteador } = await import("../rotas");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider
        router={criarRoteador(createMemoryHistory({ initialEntries: ["/inventario/arvores/a-1"] }))}
      />
    </QueryClientProvider>,
  );
  const usuario = userEvent.setup();
  await usuario.click(await screen.findByRole("tab", { name: "Histórico" }));
  await usuario.click(await screen.findByRole("button", { name: "Cadeias" }));
  return usuario;
}

describe("histórico da árvore: cadeias (M-21)", () => {
  it("abre em eventos e oferece a visão Cadeias", async () => {
    const { criarRoteador } = await import("../rotas");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider
          router={criarRoteador(
            createMemoryHistory({ initialEntries: ["/inventario/arvores/a-1"] }),
          )}
        />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("tab", { name: "Histórico" }));
    expect(await screen.findByRole("button", { name: "Eventos", pressed: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cadeias", pressed: false })).toBeVisible();
  });

  it("mostra a inspeção, a ocorrência que gerou e as tarefas, com links e estados", async () => {
    await abrirCadeias();
    const cadeia = await screen.findByRole("region", { name: "Cadeia da inspeção INS-000001" });
    expect(within(cadeia).getByRole("link", { name: "INS-000001" })).toHaveAttribute(
      "href",
      "/inspecoes/i-1",
    );
    expect(within(cadeia).getByRole("link", { name: "OCO-000007" })).toHaveAttribute(
      "href",
      "/ocorrencias/o-1",
    );
    expect(within(cadeia).getByRole("link", { name: "TAR-000012" })).toHaveAttribute(
      "href",
      "/equipes-tarefas/tf-1",
    );
    expect(within(cadeia).getByText("Em atendimento")).toBeInTheDocument();
    expect(within(cadeia).getByText("Em execução")).toBeInTheDocument();
    expect(within(cadeia).getAllByText("Concluída")).toHaveLength(2); // tarefa de origem e a TAR-000013
    // Prazo vencido de tarefa concluída não vira "atrasado há...".
    expect(within(cadeia).queryByText(/atrasado há/)).toBeNull();
  });

  it("a tarefa de inspeção abre a cadeia, antes da inspeção", async () => {
    await abrirCadeias();
    const cadeia = await screen.findByRole("region", { name: "Cadeia da inspeção INS-000001" });
    const origem = within(cadeia).getByRole("link", { name: "TAR-000005" });
    expect(origem).toHaveAttribute("href", "/equipes-tarefas/tf-0");
    expect(within(cadeia).getByText("Tarefa de inspeção")).toBeVisible();
    const inspecaoLink = within(cadeia).getByRole("link", { name: "INS-000001" });
    // Tarefa de inspeção → inspeção → ocorrência, nessa ordem no documento.
    expect(origem.compareDocumentPosition(inspecaoLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // A cadeia sem tarefa de origem (INS-000000) não mostra o passo.
    const sem = screen.getByRole("region", { name: "Cadeia da inspeção INS-000000" });
    expect(within(sem).queryByText("Tarefa de inspeção")).toBeNull();
  });

  it("sem permissão de tarefas, a tarefa de origem não aparece", async () => {
    eu = { ...COMPLETO, permissoes: ["inventario.ler", "inspecoes.ler", "ocorrencias.ler"] };
    await abrirCadeias();
    await screen.findByRole("region", { name: "Cadeia da inspeção INS-000001" });
    expect(screen.queryByRole("link", { name: "TAR-000005" })).toBeNull();
  });

  it("inspeção sem desdobramento diz isso, e a ocorrência avulsa tem cadeia própria", async () => {
    await abrirCadeias();
    const sem = await screen.findByRole("region", { name: "Cadeia da inspeção INS-000000" });
    expect(
      within(sem).getByText(/Requer encaminhamento, mas ainda não gerou ocorrência/),
    ).toBeVisible();
    const avulsaCadeia = screen.getByRole("region", { name: "Cadeia sem inspeção de origem" });
    expect(within(avulsaCadeia).getByRole("link", { name: "OCO-000009" })).toBeVisible();
    // Da mais recente para a mais antiga: avulsa (20/10), INS-000001 (01/10), INS-000000 (01/08).
    const regioes = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regioes).toEqual([
      "Cadeia sem inspeção de origem",
      "Cadeia da inspeção INS-000001",
      "Cadeia da inspeção INS-000000",
    ]);
  });

  it("sem permissão de ocorrências, mostra só as inspeções e avisa", async () => {
    eu = { ...COMPLETO, permissoes: ["inventario.ler", "inspecoes.ler"] };
    await abrirCadeias();
    expect(await screen.findByText(/Sem acesso às ocorrências/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "OCO-000007" })).toBeNull();
    expect(screen.queryByRole("link", { name: "TAR-000012" })).toBeNull();
    expect(consultas.every((u) => u.pathname.endsWith("/inspecoes"))).toBe(true);
  });
});
