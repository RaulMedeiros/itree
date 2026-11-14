import { configurarCliente, type Eu } from "@itree/api-client";
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
vi.mock("maplibre-gl", () => ({ setWorkerUrl: () => undefined }));
vi.mock("../paginas/visao-geral/MapaResumo", () => ({ MapaResumo: () => null }));

const API = "http://api.teste";

const GESTOR: Eu = {
  id: "u-g",
  nome: "Gil Gestor",
  email: "gil@itree.teste",
  papeis: ["gestor"],
  permissoes: ["mapa.ler", "inventario.ler", "relatorios.ler"],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

function indicador(extra: Record<string, unknown>) {
  return {
    definicao: "d",
    formula: "f",
    base: null,
    unidade: "",
    periodo: "instantâneo",
    fonte: "Registros da plataforma",
    link: null,
    anterior: null,
    anterior_em: null,
    serie: [],
    ...extra,
  };
}

function painel(extra: Record<string, unknown> = {}) {
  return {
    periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
    filtros: { bairro: null, equipe: null },
    calculado_em: "2026-10-31T12:00:00Z",
    indicadores: [],
    distribuicoes: {},
    series_mensais: { meses: [], definicao: "", series: [] },
    pendencias: [],
    bairros_atencao: { titulo: "Bairros que pedem atenção", definicao: "", formula: "", itens: [] },
    equipes: [],
    atividades: [],
    ...extra,
  };
}

const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/territorios`, () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => servidor.resetHandlers());
afterAll(() => servidor.close());

async function abrirComPainel(corpo: object) {
  servidor.use(http.get(`${API}/api/v1/indicadores/painel`, () => HttpResponse.json(corpo)));
  const { criarRoteador } = await import("../rotas");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider
        router={criarRoteador(createMemoryHistory({ initialEntries: ["/visao-geral"] }))}
      />
    </QueryClientProvider>,
  );
}

const cartaoDe = async (nome: string) =>
  (await screen.findByText(nome)).closest(".rounded-xl") as HTMLElement;

describe("visão geral: comparação sobre base pequena (R2-22)", () => {
  it("mostra a diferença absoluta, não o percentual, quando o período anterior é menor que 30", async () => {
    await abrirComPainel(
      painel({
        indicadores: [
          indicador({
            id: "inspecoes_realizadas",
            nome: "Inspeções realizadas",
            valor: 7,
            periodo: "selecionado",
            anterior: 2,
            anterior_em: "2026-09-11",
          }),
        ],
      }),
    );
    const cartao = await cartaoDe("Inspeções realizadas");
    expect(within(cartao).getByText(/^\+5 desde 11\/09\/26/)).toBeInTheDocument();
    expect(within(cartao).queryByText(/250%/)).toBeNull();
  });

  it("mantém o percentual quando a base anterior é grande", async () => {
    await abrirComPainel(
      painel({
        indicadores: [
          indicador({
            id: "inspecoes_realizadas",
            nome: "Inspeções realizadas",
            valor: 60,
            periodo: "selecionado",
            anterior: 40,
            anterior_em: "2026-09-11",
          }),
        ],
      }),
    );
    const cartao = await cartaoDe("Inspeções realizadas");
    expect(within(cartao).getByText(/^\+50% desde 11\/09\/26/)).toBeInTheDocument();
  });
});

describe("visão geral: árvores sem espécie confirmada (R2-09)", () => {
  it("o link leva à lista de árvores filtrada por espécie não confirmada", async () => {
    await abrirComPainel(
      painel({
        distribuicoes: {
          especies: {
            titulo: "Espécies confirmadas (10 mais frequentes)",
            definicao: "d",
            nao_confirmadas: 165,
            itens: [{ rotulo: "Licania tomentosa", quantidade: 3 }],
          },
        },
      }),
    );
    const link = await screen.findByRole("link", { name: "Ver 165 árvores" });
    const destino = new URL(link.getAttribute("href")!, "http://x");
    expect(destino.pathname).toBe("/inventario/arvores");
    expect(destino.searchParams.get("especie_estado")).toBe("nao_confirmada");
    expect(destino.searchParams.get("valida")).toBe("true");
    expect(screen.queryByRole("link", { name: "Ver catálogo" })).toBeNull();
  });
});

describe("visão geral: cartões enxutos e sem repetição (R2-02, R2-03)", () => {
  const dados = painel({
    indicadores: [
      indicador({
        id: "arvores_registros",
        nome: "Árvores cadastradas (registros)",
        valor: 243,
      }),
      indicador({
        id: "arvores_validas",
        nome: "Árvores com registro válido",
        definicao: "Registros ativos, com localização e origem conhecida.",
        valor: 200,
      }),
      indicador({
        id: "cobertura_inspecao",
        nome: "Inspecionadas nos últimos 12 meses",
        valor: 10,
        base: 200,
        unidade: "%",
      }),
      indicador({ id: "com_medidas", nome: "Com altura ou DAP", valor: 98.8, unidade: "%" }),
      indicador({
        id: "inspecoes_em_revisao",
        nome: "Inspeções aguardando revisão",
        valor: 6,
      }),
      indicador({ id: "tarefas_atrasadas", nome: "Tarefas atrasadas", valor: 4 }),
      indicador({ id: "ocorrencias_atrasadas", nome: "Ocorrências atrasadas", valor: 0 }),
      indicador({
        id: "tarefas_inspecao_pendentes",
        nome: "Inspeções pendentes (tarefas)",
        valor: 13,
      }),
    ],
    pendencias: [
      {
        id: "inspecoes_em_revisao",
        titulo: "Inspeções aguardando revisão",
        gravidade: "media",
        quantidade: 6,
        link: { pagina: "/inspecoes", filtros: { estado: "em_revisao" } },
      },
      {
        id: "tarefas_atrasadas",
        titulo: "Tarefas com prazo vencido",
        gravidade: "alta",
        quantidade: 4,
        link: { pagina: "/equipes-tarefas", filtros: { atrasadas: "true" } },
      },
    ],
  });

  it("a face do cartão não traz base, critério nem janela: isso fica em “Como é calculado”", async () => {
    await abrirComPainel(dados);
    const cartao = await cartaoDe("Inspecionadas nos últimos 12 meses");
    const detalhes = cartao.querySelector("details")!;
    for (const texto of [/^Base: 200/, /^Janela: fixa de 12 meses \(ignora o período\)/]) {
      expect(within(detalhes).getByText(texto)).toBeInTheDocument();
    }
    // Fora do <details>, só valor e nome (sem "Situação atual", "Base:" ou "Válido:").
    const face = cartao.cloneNode(true) as HTMLElement;
    face.querySelector("details")!.remove();
    expect(face.textContent).not.toMatch(/Base|ignora o período|Situação atual|Válido/);
    // O 1º cartão leva a contagem de registros para o "Como é calculado".
    const validas = await cartaoDe("Árvores com registro válido");
    expect(
      within(validas.querySelector("details")!).getByText(/^Base: 243 registros/),
    ).toBeInTheDocument();
  });

  it("os cartões esticam para a mesma altura na linha", async () => {
    await abrirComPainel(dados);
    for (const nome of ["Árvores com registro válido", "Inspecionadas nos últimos 12 meses"]) {
      const cartao = await cartaoDe(nome);
      expect(cartao.className).toMatch(/\bh-full\b/);
      expect(cartao.className).toMatch(/\bflex-col\b/);
    }
  });

  it("“Outros indicadores” não repete cartões nem pendências", async () => {
    await abrirComPainel(dados);
    const painelOutros = (await screen.findByRole("heading", { name: "Outros indicadores" }))
      .parentElement as HTMLElement;
    const lista = within(painelOutros);
    expect(lista.getByText("Com altura ou DAP")).toBeInTheDocument();
    expect(lista.getByText("Inspeções pendentes (tarefas)")).toBeInTheDocument();
    // Ocorrências atrasadas não está nas pendências (zero): continua aparecendo, com 0.
    expect(lista.getByText("Ocorrências atrasadas")).toBeInTheDocument();
    for (const repetido of [
      "Árvores cadastradas (registros)",
      "Árvores com registro válido",
      "Inspeções aguardando revisão",
      "Tarefas atrasadas",
    ]) {
      expect(lista.queryByText(repetido)).toBeNull();
    }
  });
});

describe("visão geral: bairros que pedem atenção (G-02)", () => {
  const ranking = {
    titulo: "Bairros que pedem atenção",
    definicao: "Os 5 bairros do seu escopo com maior índice.",
    formula: "10 × risco + 5 × atrasadas + 2 × ruins ou mortas + 1 × sem inspeção",
    itens: [
      {
        id: "b-1",
        nome: "Meireles",
        indice: 19,
        componentes: [
          { id: "risco_confirmado", rotulo: "Risco confirmado", quantidade: 1, peso: 10 },
          { id: "atrasadas", rotulo: "Ocorrências atrasadas", quantidade: 1, peso: 5 },
          { id: "ruins_ou_mortas", rotulo: "Árvores ruins ou mortas", quantidade: 2, peso: 2 },
          { id: "sem_inspecao", rotulo: "Sem inspeção há 12 meses", quantidade: 0, peso: 1 },
        ],
        link: { pagina: "/mapa", filtros: { destaque: "b-1" } },
      },
      {
        id: "b-2",
        nome: "Aldeota",
        indice: 3,
        componentes: [
          { id: "risco_confirmado", rotulo: "Risco confirmado", quantidade: 0, peso: 10 },
          { id: "atrasadas", rotulo: "Ocorrências atrasadas", quantidade: 0, peso: 5 },
          { id: "ruins_ou_mortas", rotulo: "Árvores ruins ou mortas", quantidade: 0, peso: 2 },
          { id: "sem_inspecao", rotulo: "Sem inspeção há 12 meses", quantidade: 3, peso: 1 },
        ],
        link: { pagina: "/mapa", filtros: { destaque: "b-2" } },
      },
    ],
  };

  it("lista os bairros na ordem do servidor, com cada componente e o índice", async () => {
    await abrirComPainel(painel({ bairros_atencao: ranking }));
    const tabela = await screen.findByRole("table");
    const linhas = within(tabela).getAllByRole("row").slice(1);
    expect(linhas).toHaveLength(2);
    const [meireles, aldeota] = linhas.map((l) =>
      within(l)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    );
    expect(meireles).toEqual(["1.Meireles", "1", "1", "2", "0", "19"]);
    expect(aldeota?.[0]).toBe("2.Aldeota");
    expect(within(tabela).getByRole("columnheader", { name: "Risco confirmado" })).toBeVisible();
  });

  it("cada bairro abre o mapa com o bairro em destaque e a fórmula fica em “Como é calculado”", async () => {
    await abrirComPainel(painel({ bairros_atencao: ranking }));
    const link = await screen.findByRole("link", { name: "Meireles: ver no mapa" });
    const destino = new URL(link.getAttribute("href")!, "http://x");
    expect(destino.pathname).toBe("/mapa");
    expect(destino.searchParams.get("destaque")).toBe("b-1");
    expect(screen.getByText(/^Índice = 10 × risco \+ 5 × atrasadas/)).toBeInTheDocument();
  });

  it("sem bairro com pendência, diz isso em vez de mostrar tabela vazia", async () => {
    await abrirComPainel(painel());
    expect(await screen.findByText("Nenhum bairro com pendência no momento.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("visão geral: criar tarefas para as árvores sem avaliação", () => {
  const condicao = painel({
    distribuicoes: {
      condicao_aparente: {
        titulo: "Condição aparente registrada",
        definicao: "d",
        itens: [
          { rotulo: "Boa", quantidade: 5 },
          { rotulo: "Sem avaliação registrada", quantidade: 40 },
        ],
      },
    },
  });
  const comTarefas = () =>
    http.get(`${API}/api/v1/eu`, () =>
      HttpResponse.json({ ...GESTOR, permissoes: [...GESTOR.permissoes, "tarefas.editar"] }),
    );
  const contadores = (limite: number) =>
    http.get(`${API}/api/v1/arvores/contadores`, () =>
      HttpResponse.json({ total: 40, validos: 40, limite_tarefas_em_lote: limite }),
    );

  it("abre o diálogo de lote com os filtros das sem avaliação", async () => {
    const usuario = userEvent.setup();
    const corpos: { filtros_arvores?: Record<string, string> }[] = [];
    servidor.use(
      comTarefas(),
      contadores(500),
      http.get(`${API}/api/v1/equipes`, () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
      http.post(`${API}/api/v1/tarefas/lote`, async ({ request }) => {
        corpos.push((await request.json()) as never);
        return HttpResponse.json({ criadas: 40, ignoradas: 0, fora_do_escopo_do_responsavel: 0 });
      }),
    );
    await abrirComPainel(condicao);
    await usuario.click(
      await screen.findByRole("button", {
        name: "Criar 40 tarefas de inspeção",
      }),
    );
    const dialogo = await screen.findByRole("dialog", {
      name: "Criar tarefas de inspeção para 40 árvores",
    });
    await usuario.click(within(dialogo).getByRole("button", { name: "Criar" }));
    await vi.waitFor(() =>
      expect(corpos[0]?.filtros_arvores).toEqual({ condicao_aparente: "sem", valida: "true" }),
    );
  });

  it("acima do limite do lote, desabilita a ação e explica", async () => {
    servidor.use(comTarefas(), contadores(30));
    await abrirComPainel(condicao);
    const botao = await screen.findByRole("button", {
      name: "Criar 40 tarefas de inspeção",
    });
    await vi.waitFor(() => expect(botao).toBeDisabled());
    // Largura do cartão e texto que quebra: não estoura a borda (R3-17).
    expect(botao.className).toMatch(/\bw-full\b/);
    expect(botao.className).toMatch(/whitespace-normal/);
    expect(screen.getByText(/O limite é de 30 árvores por lote/)).toBeInTheDocument();
  });

  it("sem permissão de editar tarefas, não oferece a ação", async () => {
    await abrirComPainel(condicao);
    await screen.findByText("Sem avaliação registrada");
    expect(screen.queryByRole("button", { name: /Criar tarefas de inspeção/ })).toBeNull();
  });
});

describe("visão geral: ocorrências em aberto por prioridade", () => {
  it("cada barra usa a cor da prioridade no mapa e traz o rótulo em texto", async () => {
    await abrirComPainel(
      painel({
        distribuicoes: {
          ocorrencias_prioridade: {
            titulo: "Ocorrências em aberto por prioridade",
            definicao: "d",
            itens: [
              { rotulo: "Baixa", quantidade: 9 },
              { rotulo: "Urgente", quantidade: 2 },
              { rotulo: "Sem prioridade definida", quantidade: 4 },
              { rotulo: "Média", quantidade: 6 },
              { rotulo: "Alta", quantidade: 3 },
            ],
          },
        },
      }),
    );
    const titulo = await screen.findByRole("heading", {
      name: "Ocorrências em aberto por prioridade",
    });
    const itens = within(titulo.parentElement as HTMLElement).getAllByRole("listitem");
    // Do mais urgente ao menos, cada um com o rótulo em texto e a cor do mapa (simbologia.ts).
    expect(itens.map((li) => li.textContent)).toEqual([
      "Urgente2",
      "Alta3",
      "Média6",
      "Baixa9",
      "Sem prioridade definida4",
    ]);
    const corDa = (li: HTMLElement) =>
      (li.querySelector("span.h-3") as HTMLElement).style.background;
    expect(itens.map(corDa)).toEqual([
      "rgb(201, 42, 42)", // #c92a2a
      "rgb(232, 89, 12)", // #e8590c
      "rgb(227, 160, 8)", // #e3a008
      "rgb(28, 126, 214)", // #1c7ed6
      "rgb(73, 80, 87)", // #495057
    ]);
  });
});

describe("visão geral: comparação de média sobre base pequena (R3-15)", () => {
  it("mostra a diferença em dias, não o percentual, quando a média anterior é menor que 30", async () => {
    await abrirComPainel(
      painel({
        indicadores: [
          indicador({
            id: "tempo_atendimento",
            nome: "Tempo médio de atendimento",
            valor: 7,
            unidade: "dias",
            periodo: "selecionado",
            anterior: 5,
            anterior_em: "2026-09-01",
          }),
        ],
      }),
    );
    const cartao = await cartaoDe("Tempo médio de atendimento");
    expect(within(cartao).getByText("+2 dias desde 01/09/26")).toBeInTheDocument();
    expect(within(cartao).queryByText(/40%/)).toBeNull();
  });

  it("a comparação cabe numa linha, sem repetir o rótulo da base nem o julgamento na face", async () => {
    await abrirComPainel(
      painel({
        indicadores: [
          indicador({
            id: "inspecoes_realizadas",
            nome: "Inspeções realizadas",
            valor: 7,
            periodo: "selecionado",
            anterior: 2,
            anterior_em: "2026-09-11",
          }),
        ],
      }),
    );
    const cartao = await cartaoDe("Inspeções realizadas");
    expect(within(cartao).queryByText(/período anterior/)).toBeNull();
    expect(within(cartao).queryByText(/vs\./)).toBeNull();
    // O sentido segue disponível para leitor de tela e na dica.
    expect(
      within(cartao)
        .getByText(/desde 11\/09\/26/)
        .closest("p"),
    ).toHaveAttribute("title", expect.stringContaining("período anterior"));
  });
});
