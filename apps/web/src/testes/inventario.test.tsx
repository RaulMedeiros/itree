import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { camposDiferentes } from "../paginas/inventario/duplicidades";
import { ordenarPendencias, type Pendencia } from "../paginas/inventario/qualidade";

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
  papeis: ["gestor"],
  permissoes: [
    "mapa.ler",
    "inventario.ler",
    "inventario.editar",
    "inventario.importar",
    "inventario.fundir_excluir",
    "inspecoes.ler",
    "inspecoes.validar",
  ],
  territorios: [{ id: "t-for", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const pagina = <T,>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

const resumo = (extra: Record<string, unknown> = {}) => ({
  id: "a-1",
  codigo: "ARV-000001",
  especie: null,
  especie_estado: "informada",
  especie_texto_original: "Oiti",
  localizacao: { longitude: -38.540452, latitude: -3.746602 },
  localizacao_origem: "importada",
  precisao_m: null,
  endereco: "Rua 1",
  bairro: null,
  situacao: "ativa",
  valida: true,
  origem_registro: "importacao",
  ocorrencias_abertas: 0,
  condicao_aparente: "ruim",
  criado_em: "2026-10-31T12:00:00Z",
  atualizado_em: "2026-10-31T12:00:00Z",
  ...extra,
});

const consultas: URL[] = [];
const decisoes: unknown[] = [];

const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(REVISOR)),
  http.get(`${API}/api/v1/arvores`, ({ request }) => {
    consultas.push(new URL(request.url));
    return HttpResponse.json(pagina([resumo()]));
  }),
  http.get(`${API}/api/v1/arvores/contadores`, () => HttpResponse.json({ total: 1, validos: 1 })),
  http.get(`${API}/api/v1/arvores/a-1`, () =>
    HttpResponse.json({
      ...resumo(),
      identificadores: [],
      medidas_atuais: [],
      observacoes: "",
      criado_por_nome: "Rita",
      motivo_situacao: "",
      em_area_verde: null,
    }),
  ),
  http.get(`${API}/api/v1/arvores/a-1/historico`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/inspecoes`, () => HttpResponse.json(pagina([]))),
  http.get(`${API}/api/v1/evidencias`, () =>
    HttpResponse.json([
      {
        id: "e-1",
        nome_original: "copa.jpg",
        descricao: "Copa e tronco vistos da calçada, com a fachada ao fundo",
        eh_imagem: false,
        url: null,
        enviada_por_nome: "Tiago",
        criado_em: "2026-11-10T12:00:00Z",
        capturada_em: "2026-11-07T12:00:00Z",
      },
    ]),
  ),
  http.get(`${API}/api/v1/inferencias`, () =>
    HttpResponse.json([
      {
        id: "inf-1",
        tarefa: "especie",
        arvore: "a-1",
        arvore_codigo: "ARV-000001",
        inspecao: null,
        modelo: "classificador",
        versao_modelo: "0.3.1",
        resultado: {},
        alternativas: [
          { especie_id: "s-1", nome: "Cassia fistula" },
          { especie_id: "s-2", nome: "Mangifera indica" },
        ],
        qualidade_insuficiente: false,
        orientacao: "",
        decisao: "pendente",
        especie_escolhida: null,
        especie_escolhida_nome: null,
        decidida_por_nome: null,
        decidida_em: null,
        criado_em: "2026-11-10T12:00:00Z",
      },
    ]),
  ),
  http.post(`${API}/api/v1/inferencias/inf-1/decidir`, async ({ request }) => {
    decisoes.push(await request.json());
    return HttpResponse.json({});
  }),
  http.get(`${API}/api/v1/especies`, () => HttpResponse.json(pagina([]))),
  http.get(`${API}/api/v1/territorios`, () => HttpResponse.json(pagina([]))),
  http.get(`${API}/api/v1/importacoes`, () =>
    HttpResponse.json(
      pagina([
        {
          id: "l-1",
          numero: 1,
          arquivo_nome: "inv.csv",
          fonte: "Inventário sintético 2024",
          data_referencia: null,
          total_linhas: 6,
          linhas_validas: 6,
          arvores_criadas: 6,
          estado: "confirmado",
          confirmado_em: "2026-11-10T12:00:00Z",
          criado_em: "2026-11-10T12:00:00Z",
          usuario_nome: "Rita",
          pode_desfazer: false,
          motivo_nao_desfazer: "há inspeção registrada em árvores do lote.",
        },
      ]),
    ),
  ),
  http.get(`${API}/api/v1/qualidade/pendencias`, () =>
    HttpResponse.json({
      calculado_em: "2026-11-10T12:00:00Z",
      pendencias: [
        {
          id: "zero",
          titulo: "Sem localização",
          criterio: "Sem coordenadas.",
          quantidade: 0,
          gravidade: "media",
          link: null,
        },
        {
          id: "baixa",
          titulo: "Sem precisão",
          criterio: "Importada.",
          quantidade: 240,
          gravidade: "baixa",
          link: null,
        },
        {
          id: "media",
          titulo: "Espécie não identificada",
          criterio: "Sem espécie.",
          quantidade: 14,
          gravidade: "media",
          link: null,
        },
      ],
    }),
  ),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  consultas.length = 0;
  decisoes.length = 0;
});
afterAll(() => servidor.close());

async function abrir(caminho: string) {
  const { criarRoteador } = await import("../rotas");
  const roteador = criarRoteador(createMemoryHistory({ initialEntries: [caminho] }));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={roteador} />
    </QueryClientProvider>,
  );
}

describe("lista de árvores (C-13, C-14)", () => {
  it("mostra a condição aparente com texto e ordena pelo cabeçalho", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores");
    const tabela = await screen.findByRole("table");
    expect(within(tabela).getByText("Ruim")).toBeInTheDocument();
    expect(screen.getByLabelText("Última inspeção")).toBeInTheDocument();

    await usuario.click(within(tabela).getByRole("button", { name: /Atualizado em/ }));
    await vi.waitFor(() =>
      expect(consultas.at(-1)?.searchParams.get("ordenar")).toBe("-atualizado_em"),
    );
    expect(await screen.findByRole("columnheader", { name: /Atualizado em/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });
});

describe("ficha da árvore (C-15, C-17, C-18)", () => {
  it("formata coordenadas em pt-BR e separa a ação de excluir", async () => {
    await abrir("/inventario/arvores/a-1");
    expect(await screen.findByText("-3,746602, -38,540452")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Excluir/ }).className).toContain("text-perigo");
  });

  it("informa a área verde que contém a árvore, só quando há", async () => {
    await abrir("/inventario/arvores/a-1");
    await screen.findByText("-3,746602, -38,540452");
    expect(screen.queryByText("Em área verde")).not.toBeInTheDocument();

    servidor.use(
      http.get(`${API}/api/v1/arvores/a-1`, () =>
        HttpResponse.json({
          ...resumo(),
          identificadores: [],
          medidas_atuais: [],
          observacoes: "",
          criado_por_nome: "Rita",
          motivo_situacao: "",
          em_area_verde: { id: "av-1", nome: "Praça do Ferreira", tipo: "praca" },
        }),
      ),
    );
    cleanup();
    await abrir("/inventario/arvores/a-1");
    expect(await screen.findByText("Em área verde")).toBeInTheDocument();
    expect(screen.getByText("Praça do Ferreira")).toBeInTheDocument();
    expect(screen.getByText("(Praça)")).toBeInTheDocument();
  });

  it("evidência mostra a legenda inteira e quem enviou", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores/a-1");
    await usuario.click(await screen.findByRole("tab", { name: "Evidências" }));
    expect(
      await screen.findByText("Copa e tronco vistos da calçada, com a fachada ao fundo"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Enviada por Tiago/)).toBeInTheDocument();
    expect(screen.getByText(/Capturada em/)).toBeInTheDocument();
  });

  it("evidência de demonstração leva o selo Ilustração; a real não", async () => {
    const usuario = userEvent.setup();
    const base = {
      nome_original: "copa.png",
      eh_imagem: true,
      url: "http://x/copa.png",
      enviada_por_nome: "Tiago",
      criado_em: "2026-11-10T12:00:00Z",
      capturada_em: null,
    };
    servidor.use(
      http.get(`${API}/api/v1/evidencias`, () =>
        HttpResponse.json([
          { ...base, id: "e-1", descricao: "Foto sintética", ilustrativa: true },
          { ...base, id: "e-2", descricao: "Foto de campo", ilustrativa: false },
        ]),
      ),
    );
    await abrir("/inventario/arvores/a-1");
    await usuario.click(await screen.findByRole("tab", { name: "Evidências" }));
    expect(await screen.findAllByText("Ilustração")).toHaveLength(1);
    const cartao = screen.getByAltText("Foto sintética").closest("li")!;
    expect(within(cartao).getByText("Ilustração")).toBeInTheDocument();
  });

  it("sugestão de IA não vem pré-selecionada e só confirma após a escolha", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores/a-1");
    await usuario.click(await screen.findByRole("tab", { name: "Sugestões de IA" }));
    const seletor = await screen.findByLabelText("Espécie a confirmar");
    expect(seletor).toHaveValue("");
    const confirmar = screen.getByRole("button", { name: "Confirmar espécie" });
    expect(confirmar).toBeDisabled();
    await usuario.selectOptions(seletor, "s-2");
    expect(confirmar).toBeEnabled();
    await usuario.click(confirmar);
    await vi.waitFor(() => expect(decisoes).toEqual([{ decisao: "aceita", especie: "s-2" }]));
  });
});

describe("importações (C-19)", () => {
  it("explica por que o lote não pode ser desfeito", async () => {
    await abrir("/inventario/importacoes");
    expect(await screen.findByRole("button", { name: /Desfazer/ })).toBeDisabled();
    expect(
      screen.getByText(/Desfazer indisponível: há inspeção registrada em árvores do lote\./),
    ).toBeInTheDocument();
  });

  it("diz o que falta no assistente", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/importacoes");
    await usuario.click((await screen.findAllByRole("button", { name: /Nova importação/ }))[0]!);
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText("Escolha um arquivo para continuar.")).toBeInTheDocument();
    expect(within(dialogo).getByRole("list", { name: "Etapas da importação" })).toBeInTheDocument();
  });
});

describe("duplicidades (C-20)", () => {
  const a = resumo({ id: "a", codigo: "ARV-A", especie_estado: "informada" }) as never;
  const b = resumo({
    id: "b",
    codigo: "ARV-B",
    especie_estado: "confirmada",
    endereco: "Rua 2",
  }) as never;

  it("aponta os campos que diferem entre os dois registros", () => {
    expect(camposDiferentes(a, b)).toEqual(["identificacao", "endereco"]);
  });

  it("fusão não é o botão primário e a distância vem com vírgula", async () => {
    servidor.use(
      http.get(`${API}/api/v1/arvores/duplicidades`, () =>
        HttpResponse.json([
          {
            arvore_a: a,
            arvore_b: b,
            distancia_m: 1.1,
            criterio: "a 1,1 m de distância; mesma espécie",
          },
        ]),
      ),
    );
    await abrir("/inventario/duplicidades");
    expect(await screen.findByText(/A 1,1 m de distância/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fundir registros/ }).className).not.toContain(
      "bg-marca",
    );
  });
});

describe("qualidade (C-21)", () => {
  it("ordena por gravidade e quantidade e separa os itens zerados", () => {
    const itens = [
      { id: "z", quantidade: 0, gravidade: "alta" },
      { id: "b", quantidade: 240, gravidade: "baixa" },
      { id: "m", quantidade: 14, gravidade: "media" },
    ] as Pendencia[];
    const { comProblema, semProblema } = ordenarPendencias(itens);
    expect(comProblema.map((p) => p.id)).toEqual(["m", "b"]);
    expect(semProblema.map((p) => p.id)).toEqual(["z"]);
  });

  it("recolhe os zerados e não repete o prefixo Critério", async () => {
    await abrir("/inventario/qualidade");
    expect(await screen.findByText("Sem problemas (1)")).toBeInTheDocument();
    expect(screen.queryByText(/^Critério:/)).toBeNull();
  });
});
