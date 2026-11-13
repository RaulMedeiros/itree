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

const REVISOR: Eu = {
  id: "u-1",
  nome: "Rita Revisora",
  email: "rita@itree.teste",
  papeis: ["revisor"],
  permissoes: ["inventario.ler", "inventario.importar"],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const lote = (extras: Record<string, unknown>) => ({
  id: "l-1",
  numero: 7,
  arquivo_nome: "inventario.csv",
  fonte: "Inventário 2019",
  data_referencia: null,
  total_linhas: 5000,
  linhas_validas: 5000,
  arvores_criadas: 0,
  linhas_processadas: 0,
  linhas_com_falha: 0,
  erro: "",
  estado: "em_processamento",
  confirmado_em: null,
  criado_em: "2026-11-10T12:00:00Z",
  usuario_nome: "Rita",
  pode_desfazer: false,
  motivo_nao_desfazer: null,
  ...extras,
});

let consultas = 0;
const confirmacoes: string[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(REVISOR)),
  http.get(`${API}/api/v1/importacoes`, () => {
    consultas += 1;
    const respostas = [
      lote({ linhas_processadas: 1200 }),
      lote({
        estado: "confirmado",
        linhas_processadas: 5000,
        arvores_criadas: 4998,
        linhas_com_falha: 2,
        confirmado_em: "2026-11-10T12:05:00Z",
      }),
    ];
    return HttpResponse.json({
      count: 1,
      next: null,
      previous: null,
      results: [respostas[Math.min(consultas - 1, 1)]],
    });
  }),
  http.get(`${API}/api/v1/importacoes/l-1`, () =>
    HttpResponse.json({
      ...lote({ estado: "confirmado", linhas_com_falha: 2 }),
      linhas: [],
      falhas: [
        { indice: 17, motivo: "Erro inesperado ao criar a árvore desta linha." },
        { indice: 40, motivo: "Erro inesperado ao criar a árvore desta linha." },
      ],
    }),
  ),
  http.post(`${API}/api/v1/importacoes/l-1/confirmar`, () => {
    confirmacoes.push("l-1");
    return HttpResponse.json(lote({ estado: "em_processamento" }), { status: 202 });
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  consultas = 0;
  confirmacoes.length = 0;
});
afterAll(() => servidor.close());

async function abrir() {
  const { criarRoteador } = await import("../rotas");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider
        router={criarRoteador(createMemoryHistory({ initialEntries: ["/inventario/importacoes"] }))}
      />
    </QueryClientProvider>,
  );
}

describe("importação em segundo plano", () => {
  it("mostra o andamento do lote e o resultado quando termina, sem a janela de revisão", async () => {
    await abrir();
    const tabela = await screen.findByRole("table");
    expect(within(tabela).getByText("Em processamento")).toBeInTheDocument();
    expect(within(tabela).getByText(/1\.200 de 5\.000 linhas processadas/)).toBeInTheDocument();
    const barra = within(tabela).getByRole("progressbar", { name: /lote nº 7/ });
    expect(barra).toHaveAttribute("value", "1200");

    // A lista consulta de novo sozinha e passa a mostrar o resultado.
    expect(
      await within(tabela).findByText("Confirmado", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(within(tabela).getByText(/2 linhas não viraram árvore/)).toBeInTheDocument();
    expect(within(tabela).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("lista as linhas que falharam", async () => {
    const usuario = userEvent.setup();
    await abrir();
    await usuario.click(
      await screen.findByRole("button", { name: /linhas não viraram árvore/ }, { timeout: 4000 }),
    );
    const dialogo = await screen.findByRole("dialog");
    expect(await within(dialogo).findByText(/Linha 17:/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/Linha 40:/)).toBeInTheDocument();
  });

  it("oferece retomar um lote interrompido", async () => {
    servidor.use(
      http.get(`${API}/api/v1/importacoes`, () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [
            lote({
              estado: "interrompido",
              linhas_processadas: 400,
              erro: "A confirmação foi interrompida por um erro inesperado.",
            }),
          ],
        }),
      ),
    );
    const usuario = userEvent.setup();
    await abrir();
    expect(await screen.findByRole("alert")).toHaveTextContent("interrompida por um erro");
    await usuario.click(screen.getByRole("button", { name: "Retomar" }));
    await vi.waitFor(() => expect(confirmacoes).toEqual(["l-1"]));
  });
});
