import { configurarCliente, type Eu, type Ficha, type FichaCartao } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
vi.mock("maplibre-gl", () => ({ setWorkerUrl: () => undefined, Marker: vi.fn() }));
vi.mock("../mapa/Mapa", async () => ({
  Mapa: (await import("./MapaFalsoComponente")).MapaFalsoComponente,
}));
vi.mock("../mapa/simbologia", async (original) => ({
  ...(await original<typeof import("../mapa/simbologia")>()),
  registrarIcones: vi.fn(),
  aoFaltarImagem: vi.fn(),
}));

const API = "http://api.teste";
const ID = "b-aldeota";

const GESTOR: Eu = {
  id: "u-g",
  nome: "Gil Gestor",
  email: "gil@itree.teste",
  papeis: ["gestor"],
  permissoes: [
    "mapa.ler",
    "inventario.ler",
    "relatorios.ler",
    "relatorios.exportar",
    "ocorrencias.ler",
  ],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

function cartao(extra: Partial<FichaCartao> & Pick<FichaCartao, "id" | "titulo">): FichaCartao {
  return {
    valor: 0,
    unidade: "",
    detalhe: "",
    nota: "",
    sem_dado: false,
    provisorio: false,
    base: null,
    cidade: null,
    extras: [],
    fonte: "Registros da plataforma",
    fonte_url: "",
    licenca: "",
    data_referencia: "2026-11-20",
    definicao: "",
    metodo: "",
    link: null,
    ...extra,
  };
}

const CENSO = cartao({
  id: "arborizacao_entorno",
  titulo: "Faces de quadra com árvores (Censo 2022)",
  valor: 54.3,
  unidade: "%",
  detalhe: "938 de 1.449 faces de quadra",
  cidade: { valor: 48, rotulo: "Média de Fortaleza" },
  fonte: "IBGE, Censo Demográfico 2022",
  fonte_url: "https://ftp.ibge.gov.br/censo.zip",
  data_referencia: "2022-07-31",
  definicao: "Percentual das faces com árvore.",
  metodo: "V05431 + V05432 + V05433 ÷ V05400.",
  licenca: "Não declarada no FTP do IBGE",
});

const POR_MIL = cartao({
  id: "arvores_por_mil",
  titulo: "Árvores cadastradas por 1.000 habitantes",
  valor: 0.09,
  unidade: "por 1.000 hab.",
  provisorio: true,
  detalhe: "4 árvores cadastradas · 10.645,0 habitantes por árvore",
  nota: "Conta só as árvores cadastradas; enquanto o inventário não cobre o bairro, um valor baixo pode indicar falta de cadastro, não falta de árvores.",
  cidade: { valor: 0.2, rotulo: "Média de Fortaleza" },
  escala: { min: 0, max: 1.5 },
  fonte: "IBGE, Censo Demográfico 2022",
});

const POPULACAO = cartao({
  id: "populacao",
  titulo: "População residente (Censo 2022)",
  valor: 42580,
  unidade: "pessoas",
  detalhe: "18.714 domicílios",
  nota: "Estimativa iTree para 2026: cerca de 45.274 pessoas (não é dado oficial; supõe crescimento uniforme entre os bairros).",
  cidade: { valor: 20072, rotulo: "Média por bairro" },
  escala: { min: 1000, max: 90000 },
  fonte: "IBGE, Censo Demográfico 2022",
});

const DENSIDADE = cartao({
  id: "densidade",
  titulo: "Densidade populacional",
  valor: 10987,
  unidade: "hab/km²",
  cidade: { valor: 7779, rotulo: "Média de Fortaleza" },
  escala: { min: 100, max: 20000 },
});

const RENDA = cartao({
  id: "renda",
  titulo: "Rendimento médio do responsável pelo domicílio (Censo 2022)",
  valor: 10572,
  unidade: "R$",
  nota: "Rendimento do responsável pelo domicílio, em R$ de 2022; não é renda per capita.",
  cidade: { valor: 3103, rotulo: "Média de Fortaleza" },
  escala: { min: 1000, max: 12000 },
});

const IDH_SEM_DADO = cartao({
  id: "idh",
  titulo: "IDH 2010 (SDE, Prefeitura de Fortaleza)",
  sem_dado: true,
  valor: null,
  unidade: "IDH",
  nota: "Sem IDH 2010 para este bairro: não existia com este nome nos limites da época.",
});

const ILHA_SEM_DADO = cartao({
  id: "ilha_calor",
  titulo: "Ilha de calor de superfície (UrbVerde, 2025)",
  sem_dado: true,
  valor: null,
  unidade: "°C",
  nota: "Veja a camada no mapa. O valor por bairro não é gravado enquanto o uso dos dados da UrbVerde não for confirmado com a USP.",
  fonte: "UrbVerde (IAU-USP): ilhas de calor urbano de superfície, 2025",
  data_referencia: "2025-12-31",
  link: { pagina: "/mapa", filtros: { ilha_calor: "1" } },
});

const ILUMINACAO = cartao({
  id: "iluminacao",
  titulo: "Árvores próximas à iluminação",
  valor: 12,
  provisorio: true,
  detalhe: "320 pontos de iluminação no bairro",
  fonte: "Prefeitura de Fortaleza, SEINF",
});

const REGRA: Ficha["regra_3_30_300"] = {
  contagem: "todas",
  calculado_em: "2026-11-21T10:00:00Z",
  data: "2026-11-21",
  base_edificacoes: "residenciais",
  base_texto: "edificações em lote de uso residencial (SEFIN, 2022)",
  edificacoes: 8194,
  classificadas: 8000,
  edificacoes_no_bairro: 9000,
  limiar_ndvi: 0.4,
  regra: "Regra 3-30-300: 3 árvores visíveis de cada casa.",
  fonte_metodo: "Konijnendijk, C. C. (2022). Journal of Forestry Research, 33, 1707-1717.",
  fonte_url: "https://doi.org/10.1007/s11676-022-01523-z",
  metodo: "Distância euclidiana do ponto central da edificação.",
  ressalva: "Conta só as árvores do inventário.",
  rotulo_cidade: "Fortaleza",
  partes: [
    {
      id: "3",
      nome: "3 árvores a até 30 m",
      meta: "3 árvores a até 30 m",
      meta_pct: 100,
      unidade: "% das edificações",
      valor: 12.5,
      numerador: 1024,
      denominador: 8194,
      cidade: 20,
      atende: false,
      sem_dado: false,
      nota: "",
      definicao: "Percentual das edificações com 3 árvores a até 30 m.",
    },
    {
      id: "30",
      nome: "30% de cobertura vegetal",
      meta: "30% de cobertura",
      meta_pct: 30,
      unidade: "% da área do bairro",
      valor: null,
      numerador: null,
      denominador: null,
      cidade: null,
      atende: null,
      sem_dado: true,
      nota: "Sem cobertura vegetal: o NDVI não cobre Fortaleza.",
      definicao: "Percentual da área com vegetação.",
    },
    {
      id: "300",
      nome: "Área verde a até 300 m",
      meta: "área verde a até 300 m",
      meta_pct: 100,
      unidade: "% das edificações",
      valor: 100,
      numerador: 8194,
      denominador: 8194,
      cidade: 39.4,
      atende: true,
      sem_dado: false,
      nota: "",
      definicao: "Percentual das edificações a até 300 m de área verde.",
    },
  ],
};

function ficha(cartoes: FichaCartao[], extra: Partial<Ficha> = {}): Ficha {
  return {
    gerado_em: "2026-11-20T15:00:00Z",
    bairro: {
      id: ID,
      nome: "Aldeota",
      codigo: "2304400001",
      regional: { id: "r-2", nome: "SER 2" },
      area_km2: 3.88,
      oficial: true,
      selo: "Bairro oficial (Ipplan)",
      fonte: "Fortaleza em Mapas (Ipplan Fortaleza)",
      fonte_url: "",
      data_referencia: "2022-11-13",
      limites: [-38.51, -3.75, -38.48, -3.72],
      geometria: { type: "MultiPolygon", coordinates: [] },
    },
    cartoes,
    regra_3_30_300: REGRA,
    macrozoneamento: {
      zonas: [
        { nome: "Zona de Ocupação Preferencial 1", sigla: "ZOP 1", pct: 80 },
        { nome: "Zona de Orla - Trecho I", sigla: "ZO", pct: 20 },
      ],
      predominante: "Zona de Ocupação Preferencial 1",
      fonte: "SEUMA, Macrozoneamento Urbano de Fortaleza, 2022",
      fonte_url: "",
      licenca: "Termos da API",
      data_referencia: "2022-12-31",
    },
    graficos: {
      especies: {
        titulo: "Composição por espécie",
        definicao: "As 8 espécies confirmadas mais frequentes.",
        itens: [
          { id: "", rotulo: "Licania tomentosa", valor: 40 },
          { id: "outras", rotulo: "Outras (3 espécies)", valor: 10 },
        ],
        total_confirmadas: 50,
        fonte: "Registros da plataforma",
      },
      condicao: {
        titulo: "Condição aparente",
        definicao: "Última condição validada.",
        itens: [
          { id: "boa", rotulo: "Boa", valor: 30 },
          { id: "ruim", rotulo: "Ruim", valor: 5 },
          { id: "sem", rotulo: "Sem avaliação registrada", valor: 65 },
        ],
        fonte: "Registros da plataforma",
      },
      ocorrencias_mensais: {
        titulo: "Ocorrências registradas por mês",
        definicao: "Últimos 12 meses.",
        meses: ["2026-10", "2026-11"],
        valores: [3, 1],
        fonte: "Registros da plataforma",
      },
    },
    ranking: {
      titulo: "Bairros que pedem atenção",
      definicao: "O índice soma, com pesos...",
      formula: "10 × risco + 5 × atrasadas",
      posicao: 3,
      total: 18,
      indice: 24,
      componentes: [
        {
          id: "risco_confirmado",
          rotulo: "Ocorrências abertas com risco confirmado",
          quantidade: 1,
          peso: 10,
        },
        { id: "atrasadas", rotulo: "Ocorrências atrasadas", quantidade: 0, peso: 5 },
      ],
      fonte: "Registros da plataforma",
    },
    ...extra,
  };
}

const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/territorios`, () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  http.get(`${API}/api/v1/areas-verdes`, () =>
    HttpResponse.json({ type: "FeatureCollection", features: [] }),
  ),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  mapasCriados.length = 0;
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

const servirFicha = (corpo: Ficha) =>
  servidor.use(http.get(`${API}/api/v1/bairros/${ID}/ficha`, () => HttpResponse.json(corpo)));

describe("ficha do bairro: população, renda e IDH", () => {
  it("mostra os cartões com a unidade, a régua pela escala dos bairros e a estimativa com a hipótese", async () => {
    servirFicha(ficha([POPULACAO, DENSIDADE, POR_MIL, RENDA, IDH_SEM_DADO]));
    await abrir(`/bairros/${ID}`);
    const populacao = await screen.findByRole("article", { name: POPULACAO.titulo });
    expect(within(populacao).getByText("42.580")).toBeVisible();
    expect(within(populacao).getByText(/Estimativa iTree para 2026/)).toBeVisible();
    expect(within(populacao).getByText(/supõe crescimento uniforme/)).toBeVisible();
    // Régua bairro × cidade também nos indicadores que não são percentuais.
    expect(
      within(populacao).getByRole("img", {
        name: /Aldeota: 42\.580\. Média por bairro: 20\.072\./,
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("article", { name: DENSIDADE.titulo })).getByText("10.987 hab/km²"),
    ).toBeVisible();
    const renda = screen.getByRole("article", { name: RENDA.titulo });
    expect(within(renda).getByText("R$ 10.572")).toBeVisible();
    expect(within(renda).getByText(/não é renda per capita/)).toBeVisible();
    expect(screen.getByTestId("regua-renda")).toBeVisible();
  });

  it("árvores por 1.000 habitantes traz o selo provisório e a ressalva do inventário", async () => {
    servirFicha(ficha([POR_MIL]));
    await abrir(`/bairros/${ID}`);
    const cartao = await screen.findByRole("article", { name: POR_MIL.titulo });
    expect(within(cartao).getByText("Provisório")).toBeVisible();
    expect(within(cartao).getByText("0,09 por 1.000 hab.")).toBeVisible();
    expect(
      within(cartao).getByText(/pode indicar falta de cadastro, não falta de árvores/),
    ).toBeVisible();
    expect(within(cartao).getByText(/habitantes por árvore/)).toBeVisible();
    expect(within(cartao).queryByText(/índice oficial/i)).toBeNull();
  });

  it("bairro sem IDH diz que não há dado, nunca zero", async () => {
    servirFicha(ficha([IDH_SEM_DADO]));
    await abrir(`/bairros/${ID}`);
    const cartao = await screen.findByRole("article", { name: IDH_SEM_DADO.titulo });
    expect(within(cartao).getByText("Sem dado neste bairro")).toBeVisible();
    expect(within(cartao).getByText(/limites da época/)).toBeVisible();
  });
});

describe("ficha do bairro", () => {
  it("mostra o cabeçalho, os cartões com fonte e data, a régua e o ranking", async () => {
    servirFicha(ficha([CENSO, ILUMINACAO]));
    await abrir(`/bairros/${ID}`);

    expect(await screen.findByRole("heading", { level: 1, name: "Aldeota" })).toBeVisible();
    expect(screen.getByText("SER 2 · 3,88 km²")).toBeVisible();
    expect(screen.getByText("Bairro oficial (Ipplan)")).toBeVisible();

    const censo = screen.getByRole("article", { name: CENSO.titulo });
    expect(within(censo).getByText("54,3%")).toBeVisible();
    expect(
      within(censo).getByText(/IBGE, Censo Demográfico 2022 · dados de 31\/07\/2022/),
    ).toBeVisible();
    // Régua bairro × cidade, com os dois valores para o leitor de tela.
    expect(
      within(censo).getByRole("img", { name: /Aldeota: 54,3%\. Média de Fortaleza: 48%\./ }),
    ).toBeVisible();

    const iluminacao = screen.getByRole("article", { name: ILUMINACAO.titulo });
    expect(within(iluminacao).getByText("Provisório")).toBeVisible();
    expect(within(iluminacao).queryByTestId("regua-iluminacao")).toBeNull();

    const ranking = screen.getByRole("region", {
      name: "Posição entre os bairros que pedem atenção",
    });
    expect(within(ranking).getByText(/3º/)).toBeVisible();
    expect(within(ranking).getByText(/de 18 com pendência/)).toBeVisible();
  });

  it("cartão sem dado continua na grade, diz o motivo e leva à camada no mapa", async () => {
    servirFicha(ficha([ILHA_SEM_DADO]));
    await abrir(`/bairros/${ID}`);
    const ilha = await screen.findByRole("article", { name: ILHA_SEM_DADO.titulo });
    expect(within(ilha).getByText("Sem dado neste bairro")).toBeVisible();
    expect(within(ilha).getByText(/Veja a camada no mapa/)).toBeVisible();
    expect(within(ilha).queryByText("0")).toBeNull();
    const link = within(ilha).getByRole("link", { name: "Ver a camada no mapa" });
    const destino = new URL(link.getAttribute("href")!, "http://x");
    expect(destino.pathname).toBe("/mapa");
    expect(destino.searchParams.get("ilha_calor")).toBe('"1"'); // o roteador grafa "1" entre aspas
    expect(destino.searchParams.get("destaque")).toBe(ID);
    expect(destino.searchParams.get("zoom")).toBe("14");
  });

  it("“Ver no mapa” abre o mapa enquadrado no bairro", async () => {
    servirFicha(ficha([CENSO]));
    await abrir(`/bairros/${ID}`);
    const link = await screen.findByRole("link", { name: "Ver no mapa" });
    const destino = new URL(link.getAttribute("href")!, "http://x");
    expect(destino.pathname).toBe("/mapa");
    expect(destino.searchParams.get("destaque")).toBe(ID);
    expect(Number(destino.searchParams.get("lon"))).toBeCloseTo(-38.495, 3);
    expect(Number(destino.searchParams.get("lat"))).toBeCloseTo(-3.735, 3);
  });

  it("desenha o bairro em destaque com árvores, ocorrências e áreas verdes", async () => {
    servirFicha(ficha([CENSO]));
    await abrir(`/bairros/${ID}`);
    await screen.findByRole("heading", { level: 1, name: "Aldeota" });
    const mapa = mapasCriados[0]!;
    const fonteArvores = mapa.fontes.get("arvores");
    expect(fonteArvores?.tiles?.[0]).toContain(`/mapa/tiles/arvores/{z}/{x}/{y}?bairro=${ID}`);
    expect(mapa.fontes.get("ocorrencias")?.tiles?.[0]).toContain(`?bairro=${ID}`);
    expect(mapa.getLayer("areas-verdes-preenchimento")).toBeTruthy();
    expect(mapa.getLayer("destaque-contorno")).toBeTruthy();
    expect(mapa.fitBounds).toHaveBeenCalledWith(
      [-38.51, -3.75, -38.48, -3.72],
      expect.objectContaining({ duration: 0 }),
    );
    expect(screen.getByRole("list", { name: "Legenda do mapa do bairro" })).toBeVisible();
  });

  it("mostra os gráficos de espécie, condição e ocorrências por mês", async () => {
    servirFicha(ficha([CENSO]));
    await abrir(`/bairros/${ID}`);
    const especies = await screen.findByRole("list", { name: "Árvores por espécie confirmada" });
    expect(within(especies).getByText("Licania tomentosa")).toBeVisible();
    expect(within(especies).getByText("Outras (3 espécies)")).toBeVisible();
    const condicao = screen.getByRole("list", { name: "Árvores por condição aparente" });
    expect(within(condicao).getByText("Sem avaliação registrada")).toBeVisible();
    expect(
      screen.getByRole("img", { name: /Evolução mensal: Ocorrências registradas/ }),
    ).toBeVisible();
  });

  it("bairro fora do escopo explica em vez de mostrar erro genérico", async () => {
    servidor.use(
      http.get(`${API}/api/v1/bairros/${ID}/ficha`, () =>
        HttpResponse.json({ detail: "Este bairro está fora do seu escopo." }, { status: 403 }),
      ),
    );
    await abrir(`/bairros/${ID}`);
    expect(await screen.findByText("Este bairro está fora do seu escopo")).toBeVisible();
    expect(screen.getByRole("link", { name: "Ver os bairros do seu escopo" })).toHaveAttribute(
      "href",
      "/bairros",
    );
  });

  it("tem o link Ver no planejamento, que abre o painel deste bairro", async () => {
    servirFicha(ficha([CENSO]));
    await abrir(`/bairros/${ID}`);
    expect(await screen.findByRole("link", { name: /Ver no planejamento/ })).toHaveAttribute(
      "href",
      `/planejamento?bairro=${ID}`,
    );
  });

  it("Exportar PDF baixa o relatório filtrado pelo bairro", async () => {
    servirFicha(ficha([CENSO]));
    let pedido: URL | null = null;
    servidor.use(
      http.get(`${API}/api/v1/relatorios/painel.pdf`, ({ request }) => {
        pedido = new URL(request.url);
        return new HttpResponse(new Uint8Array([37, 80, 68, 70]), {
          headers: { "Content-Type": "application/pdf" },
        });
      }),
    );
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    await abrir(`/bairros/${ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Exportar PDF" }));
    await vi.waitFor(() => expect(pedido?.searchParams.get("bairro")).toBe(ID));
  });
});

describe("ligações para a ficha", () => {
  it("a lista de bairros leva a nome do bairro à ficha e filtra pela busca", async () => {
    servidor.use(
      http.get(`${API}/api/v1/bairros`, () =>
        HttpResponse.json([
          {
            id: ID,
            nome: "Aldeota",
            tipo: "bairro",
            codigo: "1",
            pai: { id: "r", nome: "SER 2", tipo: "regional" },
            arvores_no_escopo: 1234,
          },
          {
            id: "b-2",
            nome: "Messejana",
            tipo: "bairro",
            codigo: "2",
            pai: null,
            arvores_no_escopo: 0,
          },
        ]),
      ),
      http.get(`${API}/api/v1/indicadores/externos/arborizacao-entorno`, () =>
        HttpResponse.json({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: ID,
              geometry: null,
              properties: { id: ID, nome: "Aldeota", valor: 64.7 },
            },
          ],
          proveniencia: null,
        }),
      ),
    );
    await abrir("/bairros");
    const link = await screen.findByRole("link", { name: "Aldeota" });
    expect(link).toHaveAttribute("href", `/bairros/${ID}`);
    expect(screen.getByText("64,7%")).toBeVisible();
    expect(screen.getByText("1.234")).toBeVisible();
    expect(screen.getByText("sem dado")).toBeVisible();

    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar bairro" }), "messe");
    expect(await screen.findByRole("link", { name: "Messejana" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Aldeota" })).toBeNull();
  });
});

describe("Ficha do bairro: regra 3-30-300", () => {
  it("mostra os três medidores com meta, valor do bairro, cidade e selo", async () => {
    servirFicha(ficha([]));
    await abrir(`/bairros/${ID}`);
    const bloco = await screen.findByRole("region", { name: "Regra 3-30-300" });
    const tres = within(bloco).getByTestId("regra-parte-3");
    expect(within(tres).getByText("12,5%")).toBeVisible();
    expect(within(tres).getByText("Não atende")).toBeVisible();
    expect(within(tres).getByText(/Fortaleza:/)).toHaveTextContent("20%");
    expect(within(within(bloco).getByTestId("regra-parte-300")).getByText("Atende")).toBeVisible();
    const trinta = within(bloco).getByTestId("regra-parte-30");
    expect(within(trinta).getByText("Sem dado")).toBeVisible();
    expect(within(trinta).getByText(/NDVI não cobre/)).toBeVisible();
    expect(within(bloco).getByText(/Konijnendijk/)).toBeVisible();
    expect(within(bloco).getByText(/lote de uso residencial/)).toBeVisible();
  });

  it("“Como é calculado” traz o método e a escolha das árvores refaz o pedido", async () => {
    const pedidos: (string | null)[] = [];
    servidor.use(
      http.get(`${API}/api/v1/bairros/${ID}/ficha`, ({ request }) => {
        pedidos.push(new URL(request.url).searchParams.get("contagem"));
        return HttpResponse.json(ficha([]));
      }),
    );
    const usuario = userEvent.setup();
    await abrir(`/bairros/${ID}`);
    const bloco = await screen.findByRole("region", { name: "Regra 3-30-300" });
    await usuario.click(within(bloco).getByText("Como é calculado").closest("summary")!);
    expect(within(bloco).getByText(/Distância euclidiana/)).toBeVisible();
    await usuario.selectOptions(
      within(bloco).getByLabelText("Árvores contadas na regra 3-30-300"),
      "confirmadas",
    );
    await vi.waitFor(() => expect(pedidos).toContain("confirmadas"));
  });

  it("mostra o macrozoneamento do bairro", async () => {
    servirFicha(ficha([]));
    await abrir(`/bairros/${ID}`);
    const zonas = await screen.findByRole("region", { name: "Macrozoneamento" });
    expect(within(zonas).getByText(/Zona predominante/)).toHaveTextContent("Preferencial 1");
    expect(within(zonas).getByText("80% da área")).toBeVisible();
  });
});
