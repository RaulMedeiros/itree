import { configurarCliente, type Especie, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
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
vi.mock("maplibre-gl", () => ({ setWorkerUrl: () => undefined }));

const API = "http://api.teste";

const LEITOR: Eu = {
  id: "u-1",
  nome: "Lia Leitora",
  email: "lia@itree.teste",
  papeis: ["consulta"],
  permissoes: ["mapa.ler", "inventario.ler"],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const OITI = {
  id: "e-1",
  nome_cientifico: "Licania tomentosa",
  familia: "Chrysobalanaceae",
  nomes_comuns: ["Oiti"],
  nativa_brasil: true,
  ativa: true,
  sucessora: null,
  fonte_taxonomica: "",
  arvores_no_escopo: 24,
  referencias_situacao: "encontradas",
  referencias_mensagem: "",
  referencias_consultadas_em: "2026-11-01T12:00:00Z",
  wikidata_id: "Q1234",
  wikidata_url: "https://www.wikidata.org/wiki/Q1234",
  wikipedia_idioma: "pt",
  wikipedia_titulo: "Oiti",
  wikipedia_url: "https://pt.wikipedia.org/wiki/Oiti",
  wikipedia_descricao: "espécie de planta",
  wikipedia_resumo: "O oiti é uma árvore da família Chrysobalanaceae.",
  gbif_id: 5583617,
  gbif_url: "https://www.gbif.org/species/5583617",
  imagem_url: "https://upload.wikimedia.org/oiti.jpg",
  imagem_pagina_url: "https://commons.wikimedia.org/wiki/File:Oiti.jpg",
  imagem_autor: "Fulana de Tal",
  imagem_licenca: "CC BY-SA 4.0",
  imagem_licenca_url: "https://creativecommons.org/licenses/by-sa/4.0",
} as unknown as Especie;

const SEM_REFERENCIA = {
  ...OITI,
  id: "e-2",
  nome_cientifico: "Cassia fistula",
  nomes_comuns: [],
  nativa_brasil: null,
  arvores_no_escopo: 1,
  referencias_situacao: "nao_encontradas",
  wikipedia_url: "",
  wikipedia_resumo: "",
  wikipedia_descricao: "",
  imagem_url: "",
  gbif_url: "",
  wikidata_url: "",
} as unknown as Especie;

const consultas: URLSearchParams[] = [];
const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(LEITOR)),
  http.get(`${API}/api/v1/especies`, ({ request }) => {
    consultas.push(new URL(request.url).searchParams);
    return HttpResponse.json({
      count: 2,
      next: null,
      previous: null,
      results: [OITI, SEM_REFERENCIA],
    });
  }),
  http.get(`${API}/api/v1/especies/e-1`, () => HttpResponse.json(OITI)),
  http.get(`${API}/api/v1/especies/e-2`, () => HttpResponse.json(SEM_REFERENCIA)),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  consultas.length = 0;
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

describe("catálogo de espécies", () => {
  it("lista espécies do escopo, mais frequentes primeiro, com origem e contagem", async () => {
    await abrir("/inventario/especies");
    expect(await screen.findByText("Licania tomentosa")).toBeInTheDocument();
    expect(screen.getByText("24 árvores")).toBeInTheDocument();
    expect(screen.getByText("1 árvore")).toBeInTheDocument();
    expect(screen.getByText("Origem não informada")).toBeInTheDocument();
    expect(consultas[0]?.get("com_arvores")).toBe("true");
    expect(consultas[0]?.get("ordem")).toBe("arvores");
  });

  it("detalhe mostra resumo com licença, crédito da imagem e links externos", async () => {
    await abrir("/inventario/especies/e-1");
    expect(await screen.findByText(/O oiti é uma árvore/)).toBeInTheDocument();
    expect(screen.getByText(/Fulana de Tal · CC BY-SA 4.0/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Wikipedia/ })).toHaveAttribute(
      "href",
      "https://pt.wikipedia.org/wiki/Oiti",
    );
    expect(screen.getByRole("link", { name: /^GBIF/ })).toHaveAttribute(
      "href",
      "https://www.gbif.org/species/5583617",
    );
    // Leitura não oferece a ação de administração.
    expect(screen.queryByRole("button", { name: /Atualizar referências/ })).toBeNull();
  });

  it("sem referência correspondente, diz isso em vez de inventar", async () => {
    await abrir("/inventario/especies/e-2");
    expect(
      await screen.findByText(/Nenhuma referência externa corresponde exatamente/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Wikipedia/ })).toBeNull();
  });
});
