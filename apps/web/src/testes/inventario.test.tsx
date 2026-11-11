import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { criarServidor } from "./servidorPadrao";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { camposDiferentes } from "../paginas/inventario/duplicidades";
import { ordenarPendencias, type Pendencia } from "../paginas/inventario/qualidade";
import { mapasCriados } from "./mapaFalso";

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
// O MapLibre precisa de WebGL, ausente no jsdom: o mini-mapa da ficha usa um mapa falso.
vi.mock("../mapa/Mapa", async () => ({
  Mapa: (await import("./MapaFalsoComponente")).MapaFalsoComponente,
}));

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
const exportacoes: Record<string, unknown>[] = [];
const pedidosLote: Record<string, unknown>[] = [];
let eu: Eu = REVISOR;
const decisoes: unknown[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/arvores`, ({ request }) => {
    consultas.push(new URL(request.url));
    return HttpResponse.json(pagina([resumo()]));
  }),
  http.get(`${API}/api/v1/equipes`, () => HttpResponse.json(pagina([]))),
  http.post(`${API}/api/v1/tarefas/lote`, async ({ request }) => {
    pedidosLote.push((await request.json()) as Record<string, unknown>);
    return HttpResponse.json(
      { criadas: 2, ignoradas: 0, fora_do_escopo_do_responsavel: 0 },
      { status: 201 },
    );
  }),
  http.post(`${API}/api/v1/relatorios/exportar-arvores`, async ({ request }) => {
    exportacoes.push((await request.json()) as Record<string, unknown>);
    return new HttpResponse("codigo\nARV-000001\n", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="itree-arvores.csv"',
      },
    });
  }),
  http.get(`${API}/api/v1/arvores/contadores`, () =>
    HttpResponse.json({ total: 1, validos: 1, limite_tarefas_em_lote: 1000 }),
  ),
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
      {
        id: "e-2",
        nome_original: "antiga.jpg",
        descricao: "Foto antiga do tronco",
        eh_imagem: true,
        url: "http://armazenamento.teste/antiga.jpg",
        enviada_por_nome: "Bia",
        criado_em: "2026-11-09T12:00:00Z",
        capturada_em: "2026-10-01T12:00:00Z",
      },
      {
        id: "e-3",
        nome_original: "recente.jpg",
        descricao: "Copa vista da calçada",
        eh_imagem: true,
        url: "http://armazenamento.teste/recente.jpg",
        enviada_por_nome: "Marta",
        criado_em: "2026-11-10T12:00:00Z",
        capturada_em: "2026-11-08T12:00:00Z",
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
  URL.createObjectURL = vi.fn(() => "blob:teste");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  servidor.resetHandlers();
  consultas.length = 0;
  exportacoes.length = 0;
  pedidosLote.length = 0;
  eu = REVISOR;
  decisoes.length = 0;
  mapasCriados.length = 0;
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

const DUAS_ARVORES = [
  resumo({ condicao_aparente: "boa", ultima_inspecao_em: "2026-10-01T12:00:00Z" }),
  resumo({
    id: "a-2",
    codigo: "ARV-000002",
    condicao_aparente: "ruim",
    ultima_inspecao_em: null,
  }),
];
const COORDENADOR: Eu = {
  ...REVISOR,
  permissoes: [...REVISOR.permissoes, "tarefas.ler", "tarefas.editar", "relatorios.exportar"],
};

describe("lista de árvores: ordenação por inspeção e condição", () => {
  it("ordena pelos cabeçalhos Última inspeção e Condição aparente", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores");
    // A tabela some enquanto a nova consulta carrega: cada clique busca o cabeçalho de novo.
    const clicar = async (nome: RegExp) =>
      usuario.click(await screen.findByRole("button", { name: nome }));
    const ordenacao = () => consultas.at(-1)?.searchParams.get("ordenar");
    await clicar(/Última inspeção/);
    await vi.waitFor(() => expect(ordenacao()).toBe("-ultima_inspecao_em"));
    await clicar(/Última inspeção/);
    await vi.waitFor(() => expect(ordenacao()).toBe("ultima_inspecao_em"));
    await clicar(/Condição aparente/);
    await vi.waitFor(() => expect(ordenacao()).toBe("-condicao_aparente"));
    expect(await screen.findByRole("columnheader", { name: /Condição aparente/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("mostra a data da última inspeção ou 'Nunca'", async () => {
    servidor.use(http.get(`${API}/api/v1/arvores`, () => HttpResponse.json(pagina(DUAS_ARVORES))));
    await abrir("/inventario/arvores");
    const linhas = await screen.findAllByRole("row");
    expect(within(linhas[1]!).getByText("01/10/2026")).toBeInTheDocument();
    expect(within(linhas[2]!).getByText("Nunca")).toBeInTheDocument();
  });
});

describe("lista de árvores: seleção em lote", () => {
  beforeEach(() => {
    servidor.use(
      http.get(`${API}/api/v1/arvores`, ({ request }) => {
        consultas.push(new URL(request.url));
        return HttpResponse.json(pagina(DUAS_ARVORES));
      }),
    );
  });

  it("seleciona a página inteira e uma a uma, e sem permissão não oferece as ações", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores");
    await screen.findByRole("table");
    expect(screen.queryByRole("region", { name: "Ações da seleção" })).toBeNull();

    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar ARV-000002" }));
    const barra = await screen.findByRole("region", { name: "Ações da seleção" });
    expect(within(barra).getByText("1 árvore selecionada")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Selecionar todas/ })).toHaveProperty(
      "indeterminate",
      true,
    );

    await usuario.click(screen.getByRole("checkbox", { name: /Selecionar todas/ }));
    expect(within(barra).getByText("2 árvores selecionadas")).toBeInTheDocument();
    // REVISOR não tem tarefas.editar nem relatorios.exportar.
    expect(within(barra).queryByRole("button", { name: /Criar tarefas/ })).toBeNull();
    expect(within(barra).queryByRole("button", { name: /Exportar seleção/ })).toBeNull();

    await usuario.click(within(barra).getByRole("button", { name: "Limpar seleção" }));
    expect(screen.queryByRole("region", { name: "Ações da seleção" })).toBeNull();
  });

  it("cria tarefas de inspeção só para as árvores marcadas", async () => {
    eu = COORDENADOR;
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores");
    await screen.findByRole("table");
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar ARV-000002" }));
    const barra = await screen.findByRole("region", { name: "Ações da seleção" });
    await usuario.click(within(barra).getByRole("button", { name: "Criar tarefas de inspeção" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/para 1 árvore/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/marcada na lista/)).toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole("button", { name: "Criar" }));
    await vi.waitFor(() =>
      expect(pedidosLote).toEqual([expect.objectContaining({ arvore_ids: ["a-2"] })]),
    );
  });

  it("exporta só a seleção, em CSV, pelos ids marcados", async () => {
    eu = COORDENADOR;
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores");
    await screen.findByRole("table");
    await usuario.click(screen.getByRole("checkbox", { name: /Selecionar todas/ }));
    const barra = await screen.findByRole("region", { name: "Ações da seleção" });
    await usuario.click(within(barra).getByRole("button", { name: /Exportar seleção/ }));
    await usuario.click(await screen.findByRole("menuitem", { name: "CSV" }));
    await vi.waitFor(() => expect(exportacoes).toHaveLength(1));
    expect(exportacoes[0]).toEqual({ formato: "csv", ids: ["a-1", "a-2"] });
  });

  it("seleciona todos os filtrados, exporta pelos filtros e cria tarefas pelo lote", async () => {
    eu = COORDENADOR;
    servidor.use(
      http.get(`${API}/api/v1/arvores`, ({ request }) => {
        consultas.push(new URL(request.url));
        return HttpResponse.json({ ...pagina(DUAS_ARVORES), count: 120 });
      }),
    );
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores?especie_estado=informada");
    await screen.findByRole("table");
    await usuario.click(screen.getByRole("checkbox", { name: /Selecionar todas/ }));
    const barra = await screen.findByRole("region", { name: "Ações da seleção" });
    await usuario.click(
      within(barra).getByRole("button", { name: "Selecionar todos os 120 filtrados" }),
    );
    expect(within(barra).getByText(/120 árvores selecionadas/)).toBeInTheDocument();
    await usuario.click(within(barra).getByRole("button", { name: /Exportar seleção/ }));
    await usuario.click(await screen.findByRole("menuitem", { name: "CSV" }));
    await vi.waitFor(() => expect(exportacoes).toHaveLength(1));
    expect(exportacoes[0]).toEqual({
      formato: "csv",
      todos_filtrados: true,
      filtros: { especie_estado: "informada" },
    });
    await usuario.click(within(barra).getByRole("button", { name: "Criar tarefas de inspeção" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/para 120 árvores/)).toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole("button", { name: "Criar" }));
    await vi.waitFor(() =>
      expect(pedidosLote).toEqual([
        expect.objectContaining({ filtros_arvores: { especie_estado: "informada" } }),
      ]),
    );
  });

  it("a seleção atravessa as páginas", async () => {
    eu = COORDENADOR;
    const outra = resumo({ id: "a-3", codigo: "ARV-000003" });
    servidor.use(
      http.get(`${API}/api/v1/arvores`, ({ request }) => {
        const url = new URL(request.url);
        consultas.push(url);
        const segunda = url.searchParams.get("pagina") === "2";
        return HttpResponse.json({ ...pagina(segunda ? [outra] : DUAS_ARVORES), count: 120 });
      }),
    );
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores");
    await screen.findByRole("table");
    await usuario.click(screen.getByRole("checkbox", { name: "Selecionar ARV-000002" }));
    await usuario.click(await screen.findByRole("button", { name: /Próxima/ }));
    await usuario.click(await screen.findByRole("checkbox", { name: "Selecionar ARV-000003" }));
    const barra = await screen.findByRole("region", { name: "Ações da seleção" });
    expect(within(barra).getByText("2 árvores selecionadas")).toBeInTheDocument();
    await usuario.click(within(barra).getByRole("button", { name: /Exportar seleção/ }));
    await usuario.click(await screen.findByRole("menuitem", { name: "CSV" }));
    await vi.waitFor(() => expect(exportacoes).toHaveLength(1));
    expect(exportacoes[0]).toEqual({ formato: "csv", ids: ["a-2", "a-3"] });
  });

  it("avisa e bloqueia a criação de tarefas acima do limite do lote", async () => {
    eu = COORDENADOR;
    servidor.use(
      http.get(`${API}/api/v1/arvores`, () =>
        HttpResponse.json({ ...pagina(DUAS_ARVORES), count: 1500 }),
      ),
    );
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores");
    await screen.findByRole("table");
    await usuario.click(screen.getByRole("checkbox", { name: /Selecionar todas/ }));
    const barra = await screen.findByRole("region", { name: "Ações da seleção" });
    await usuario.click(
      within(barra).getByRole("button", { name: "Selecionar todos os 1.500 filtrados" }),
    );
    expect(within(barra).getByText(/limite é de 1\.000 árvores por lote/)).toBeInTheDocument();
    expect(within(barra).getByRole("button", { name: "Criar tarefas de inspeção" })).toBeDisabled();
  });

  it("a seleção some quando os filtros mudam", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores");
    await screen.findByRole("table");
    await usuario.click(screen.getByRole("checkbox", { name: /Selecionar todas/ }));
    await screen.findByRole("region", { name: "Ações da seleção" });
    await usuario.selectOptions(screen.getByLabelText("Situação do registro"), "todas");
    await vi.waitFor(() =>
      expect(screen.queryByRole("region", { name: "Ações da seleção" })).toBeNull(),
    );
  });
});

const medida = (extra: Record<string, unknown>) => ({
  id: "m-1",
  tipo: "dap",
  valor: "32.00",
  unidade: "cm",
  metodo: "fita_diametrica",
  origem: "medido",
  data_medicao: "2025-10-06",
  responsavel_nome: "Inventário sintético 2024",
  observacao: "",
  criado_em: "2025-10-06T12:00:00Z",
  ...extra,
});

describe("medidas pendentes na ficha (C-16)", () => {
  const inspecaoEmRevisao = (propostas: unknown[]) =>
    http.get(`${API}/api/v1/inspecoes`, () =>
      HttpResponse.json(
        pagina([
          { id: "i-9", codigo: "INS-000006", estado: "em_revisao", medidas_propostas: propostas },
        ]),
      ),
    );

  it("mostra o valor pendente ao lado do cadastro, com o link da revisão", async () => {
    servidor.use(
      http.get(`${API}/api/v1/arvores/a-1`, () =>
        HttpResponse.json({
          ...resumo(),
          identificadores: [],
          medidas_atuais: [medida({})],
          observacoes: "",
          criado_por_nome: "Rita",
          motivo_situacao: "",
        }),
      ),
      inspecaoEmRevisao([medida({ id: "m-2", valor: "38.00", data_medicao: "2026-11-05" })]),
    );
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores/a-1");
    await usuario.click(await screen.findByRole("tab", { name: "Medidas" }));
    const aviso = await screen.findByRole("status");
    expect(aviso).toHaveTextContent("DAP 38 cm pendente");
    expect(within(aviso).getByRole("link", { name: "INS-000006" })).toHaveAttribute(
      "href",
      "/inspecoes/i-9",
    );
    const linha = screen.getByRole("row", { name: /DAP/ });
    expect(within(linha).getByText("32 cm")).toBeInTheDocument();
    expect(within(linha).getByText(/38 cm/)).toBeInTheDocument();
    expect(within(linha).getByRole("link", { name: "INS-000006" })).toBeInTheDocument();
  });

  it("mostra uma linha para a medida que só existe como proposta", async () => {
    servidor.use(
      inspecaoEmRevisao([medida({ id: "m-3", tipo: "altura", valor: "10.20", unidade: "m" })]),
    );
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores/a-1");
    await usuario.click(await screen.findByRole("tab", { name: "Medidas" }));
    const linha = await screen.findByRole("row", { name: /Altura total/ });
    expect(within(linha).getByText("Sem valor no cadastro")).toBeInTheDocument();
    expect(within(linha).getByText(/10,2 m/)).toBeInTheDocument();
  });

  it("sem medida proposta, não avisa nada", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores/a-1");
    await usuario.click(await screen.findByRole("tab", { name: "Medidas" }));
    expect(await screen.findByText("Nenhuma medida registrada")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("ficha da árvore (C-15, C-17, C-18)", () => {
  it("põe os selos do mini-mapa no canto superior, longe da atribuição do OpenStreetMap", async () => {
    await abrir("/inventario/arvores/a-1");
    const selos = (await screen.findByText("Ruim", { selector: "li" })).closest("ul")!;
    expect(selos).toHaveClass("top-2", "left-2");
    expect(selos).not.toHaveClass("bottom-2");
  });

  it('tem só as migalhas para voltar, sem o link "← Árvores" repetido', async () => {
    await abrir("/inventario/arvores/a-1");
    const migalhas = await screen.findByRole("navigation", { name: "Migalhas" });
    expect(within(migalhas).getByRole("link", { name: "Árvores" })).toHaveAttribute(
      "href",
      "/inventario/arvores",
    );
    // O link "← Árvores" (seta à esquerda) não existe mais ao lado das migalhas.
    expect(document.querySelector(".lucide-arrow-left")).toBeNull();
  });

  it("formata coordenadas em pt-BR e separa a ação de excluir", async () => {
    await abrir("/inventario/arvores/a-1");
    expect(
      await screen.findByText("lat \u22123,746602 \u00b7 lon \u221238,540452"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Excluir/ }).className).toContain("text-perigo");
  });

  it("informa a área verde que contém a árvore, só quando há", async () => {
    await abrir("/inventario/arvores/a-1");
    await screen.findByText("lat \u22123,746602 \u00b7 lon \u221238,540452");
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

  it("mostra o mini-mapa somente leitura com a cor da condição e o selo de origem", async () => {
    await abrir("/inventario/arvores/a-1");
    const regiao = await screen.findByRole("region", {
      name: "Localização de ARV-000001 no mapa (somente leitura)",
    });
    await vi.waitFor(() => expect(mapasCriados).toHaveLength(1));
    const mapa = mapasCriados[0]!;
    expect(mapa.opcoes).toMatchObject({
      somenteLeitura: true,
      centro: [-38.540452, -3.746602],
    });
    // A mesma pintura do mapa principal, alimentada com a condição e a origem da árvore.
    expect(mapa.camadaDe("arvore")?.type).toBe("circle");
    expect(mapa.dadosDe("arvore").features).toEqual([
      expect.objectContaining({
        geometry: { type: "Point", coordinates: [-38.540452, -3.746602] },
        properties: expect.objectContaining({ condicao: "ruim", localizacao_origem: "importada" }),
      }),
    ]);
    // Cor nunca sozinha: a condição e a origem aparecem em texto.
    expect(within(regiao.parentElement!).getByText("Ruim")).toBeInTheDocument();
    expect(within(regiao.parentElement!).getByText("Importada")).toBeInTheDocument();
  });

  it("mostra como foto principal a evidência mais recente que é imagem", async () => {
    await abrir("/inventario/arvores/a-1");
    const foto = await screen.findByRole("img", { name: "Copa vista da calçada" });
    expect(foto).toHaveAttribute("src", "http://armazenamento.teste/recente.jpg");
    expect(screen.getByText(/Foto enviada por Marta em/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Foto antiga do tronco" })).toBeNull();
  });

  it("evidência mostra a legenda inteira e quem enviou", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores/a-1");
    await usuario.click(await screen.findByRole("tab", { name: "Evidências" }));
    expect(
      await screen.findByText("Copa e tronco vistos da calçada, com a fachada ao fundo"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Enviada por Tiago/)).toBeInTheDocument();
    expect(screen.getAllByText(/Capturada em/).length).toBeGreaterThan(0);
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

  it("clicar na foto da ficha a amplia num diálogo com a legenda completa (R2-17)", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores/a-1");
    await usuario.click(await screen.findByRole("button", { name: "Ampliar foto" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByRole("img")).toHaveAttribute(
      "src",
      "http://armazenamento.teste/recente.jpg",
    );
    expect(within(dialogo).getByText(/Foto enviada por .* em /)).toBeInTheDocument();
    expect(within(dialogo).getByText(/Arquivo: recente\.jpg/)).toBeInTheDocument();
  });

  it('o menu "⋯" da foto remove com a justificativa obrigatória (R2-17)', async () => {
    const usuario = userEvent.setup();
    const remocoes: unknown[] = [];
    servidor.use(
      http.post(`${API}/api/v1/evidencias/:id/remover`, async ({ request, params }) => {
        remocoes.push({ id: params.id, corpo: await request.json() });
        return HttpResponse.json({});
      }),
    );
    await abrir("/inventario/arvores/a-1");
    await usuario.click(await screen.findByRole("button", { name: "Ações da foto" }));
    await usuario.click(await screen.findByRole("menuitem", { name: "Remover" }));
    const dialogo = await screen.findByRole("dialog", { name: "Remover evidência" });
    const remover = within(dialogo).getByRole("button", { name: "Remover" });
    expect(remover).toBeDisabled();
    await usuario.type(within(dialogo).getByLabelText(/Justificativa/), "Foto de outra árvore");
    await usuario.click(remover);
    await vi.waitFor(() =>
      expect(remocoes).toEqual([{ id: "e-3", corpo: { motivo: "Foto de outra árvore" } }]),
    );
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
