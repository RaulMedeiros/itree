import { configurarCliente, type Eu, type Inspecao } from "@itree/api-client";
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
    signinRedirect: vi.fn(),
    signoutRedirect: vi.fn(),
  }),
  hasAuthParams: () => false,
}));
vi.mock("../autenticacao/gerenciador", () => ({ gerenciadorUsuario: {} }));
vi.mock("maplibre-gl", () => ({ setWorkerUrl: () => undefined }));
// O mapa resumido usa WebGL, ausente no jsdom; o mapa tem testes próprios no navegador.
vi.mock("../paginas/visao-geral/MapaResumo", () => ({ MapaResumo: () => null }));

const API = "http://api.teste";

const REVISORA: Eu = {
  id: "u-rev",
  nome: "Rita Revisora",
  email: "rita@itree.teste",
  papeis: ["revisor"],
  permissoes: [
    "mapa.ler",
    "inventario.ler",
    "inspecoes.ler",
    "inspecoes.validar",
    "relatorios.ler",
  ],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const INSPECAO: Inspecao = {
  id: "i-1",
  codigo: "INS-000003",
  arvore: {
    id: "a-1",
    codigo: "ARV-000010",
    especie: null,
    especie_estado: "informada",
    localizacao: { longitude: -38.5, latitude: -3.7 },
    localizacao_origem: "importada",
    precisao_m: null,
    endereco: "Rua 1",
    bairro: "Meireles",
    condicao_aparente: "",
    condicao_aparente_em: null,
  },
  tecnico: { id: "u-tec", nome: "Tiago Técnico", email: "t@itree.teste" },
  realizada_em: "2026-10-30T13:00:00Z",
  recebida_em: "2026-10-30T15:00:00Z",
  estado: "em_revisao",
  condicao_aparente: "ruim",
  sinais: ["fungos", "cavidade"],
  especie: { id: "e-1", nome_cientifico: "Licania tomentosa", nomes_comuns: ["Oiti"] },
  especie_texto: "",
  requer_encaminhamento: true,
  origem: "app",
  revisor: null,
  validada_em: null,
  versao: 1,
  localizacao: { longitude: -38.50001, latitude: -3.70001 },
  precisao_m: 3,
  arvore_confirmada: true,
  observacoes: "Base do tronco com cavidade.",
  motivo_devolucao: "",
  aplicado_ao_cadastro: [],
  dispositivo: "android-1",
  medidas: [],
  medidas_propostas: [],
  medidas_do_cadastro: [],
  anterior: null,
  tarefa: null,
  ocorrencias_geradas: [],
};

const validacoes: unknown[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(REVISORA)),
  http.get(`${API}/api/v1/inspecoes/i-1`, () => HttpResponse.json(INSPECAO)),
  http.get(`${API}/api/v1/inspecoes/i-1/historico`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/evidencias`, () => HttpResponse.json([])),
  http.post(`${API}/api/v1/inspecoes/i-1/validar`, async ({ request }) => {
    validacoes.push(await request.json());
    return HttpResponse.json({ ...INSPECAO, estado: "validada" });
  }),
  http.get(`${API}/api/v1/mapa/busca`, () =>
    HttpResponse.json([
      {
        tipo: "arvore",
        id: "a-1",
        rotulo: "ARV-000010",
        descricao: "Rua 1",
        localizacao: null,
        limites: null,
      },
      {
        tipo: "arvore",
        id: "a-2",
        rotulo: "ARV-000011",
        descricao: "Rua 2",
        localizacao: null,
        limites: null,
      },
    ]),
  ),
  http.get(`${API}/api/v1/territorios`, () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  http.get(`${API}/api/v1/indicadores/painel`, () =>
    HttpResponse.json({
      periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
      filtros: { bairro: null, equipe: null },
      calculado_em: "2026-10-31T12:00:00Z",
      indicadores: [
        {
          id: "arvores_validas",
          nome: "Árvores com registro válido",
          definicao: "d",
          formula: "f",
          valor: 0,
          base: null,
          anterior: null,
          unidade: "",
          periodo: "instantâneo",
          fonte: "Registros da plataforma",
          link: null,
        },
        {
          id: "especie_confirmada",
          nome: "Espécie confirmada",
          definicao: "d",
          formula: "f",
          valor: null,
          base: 0,
          unidade: "%",
          periodo: "instantâneo",
          fonte: "Registros da plataforma",
          link: null,
        },
      ],
      distribuicoes: {},
      series_mensais: {
        meses: ["2025-12", "2026-01"],
        definicao: "Contagens mensais",
        series: [
          { id: "inspecoes", rotulo: "Inspeções realizadas", valores: [3, 5] },
          { id: "ocorrencias", rotulo: "Ocorrências registradas", valores: [1, 2] },
        ],
      },
      pendencias: [
        {
          id: "ocorrencias_atrasadas",
          titulo: "Ocorrências com prazo vencido",
          gravidade: "alta",
          quantidade: 4,
          link: { pagina: "/ocorrencias", filtros: { atrasadas: "true" } },
        },
      ],
      equipes: [],
      atividades: [],
    }),
  ),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  validacoes.length = 0;
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

describe("revisão de inspeção", () => {
  it("mostra sinais como possíveis e valida só o que foi marcado", async () => {
    const usuario = userEvent.setup();
    await abrir("/inspecoes/i-1");
    expect(await screen.findByText("Presença aparente de fungos")).toBeInTheDocument();
    expect(screen.getByText(/não são diagnóstico/)).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Validar…" }));
    const dialogo = await screen.findByRole("dialog");
    // Localização não vem marcada por padrão; desmarcamos também a espécie.
    expect(within(dialogo).getByRole("checkbox", { name: /Localização GPS/ })).not.toBeChecked();
    await usuario.click(within(dialogo).getByRole("checkbox", { name: /Espécie/ }));
    await usuario.click(within(dialogo).getByRole("button", { name: "Validar" }));
    await vi.waitFor(() =>
      expect(validacoes).toEqual([{ aplicar: ["condicao_aparente"], motivo: "" }]),
    );
  });
});

describe("revisão de inspeção: medidas contra o cadastro (C-25)", () => {
  const medida = (id: string, tipo: string, valor: string, unidade: string) => ({
    id,
    tipo,
    valor,
    unidade,
    metodo: "fita_diametrica",
    origem: "medido",
    data_medicao: "2026-11-05",
    responsavel_nome: "Tiago",
    observacao: "",
    criado_em: "2026-11-05T12:00:00Z",
  });

  it("mostra cada medida uma só vez, com a diferença em relação ao cadastro", async () => {
    servidor.use(
      http.get(`${API}/api/v1/inspecoes/i-1`, () =>
        HttpResponse.json({
          ...INSPECAO,
          medidas: [medida("m-1", "dap", "38.00", "cm"), medida("m-2", "altura", "10.20", "m")],
          medidas_do_cadastro: [medida("m-0", "dap", "32.00", "cm")],
        }),
      ),
    );
    await abrir("/inspecoes/i-1");
    const linhaDap = await screen.findByRole("row", { name: /^DAP/ });
    // A diferença, destacada, no mesmo lugar do valor novo.
    expect(within(linhaDap).getByText("DAP 32 → 38 cm, +6")).toBeInTheDocument();
    expect(within(linhaDap).getByText("32 cm")).toBeInTheDocument();
    expect(screen.getAllByText(/38 cm/)).toHaveLength(2); // valor novo + frase da diferença, na mesma linha
    expect(screen.getAllByRole("row", { name: /DAP/ })).toHaveLength(1);
    expect(screen.queryByText("Medidas registradas")).toBeNull();
    const linhaAltura = screen.getByRole("row", { name: /^Altura total/ });
    expect(within(linhaAltura).getByText("Sem valor no cadastro")).toBeInTheDocument();
  });
});

describe("revisão de inspeção: inspeção anterior", () => {
  const medidaDe = (tipo: string, valor: string, unidade: string) => ({
    id: `ant-${tipo}`,
    tipo,
    valor,
    unidade,
    metodo: "fita_diametrica",
    origem: "medido",
    data_medicao: "2026-08-01",
    responsavel_nome: "Tiago",
    observacao: "",
    criado_em: "2026-08-01T12:00:00Z",
  });

  it("mostra na coluna 'Inspeção anterior' as medidas da validada anterior", async () => {
    servidor.use(
      http.get(`${API}/api/v1/inspecoes/i-1`, () =>
        HttpResponse.json({
          ...INSPECAO,
          medidas: [
            { ...medidaDe("dap", "38.00", "cm"), id: "m-1" },
            { ...medidaDe("altura", "10.20", "m"), id: "m-2" },
          ],
          anterior: {
            ...INSPECAO,
            id: "i-0",
            estado: "validada",
            medidas: [medidaDe("dap", "30.00", "cm")],
          },
        }),
      ),
    );
    await abrir("/inspecoes/i-1");
    const linhaDap = await screen.findByRole("row", { name: /^DAP/ });
    expect(within(linhaDap).getByText("30 cm")).toBeInTheDocument();
    // Sem medida do tipo na anterior: traço, não o valor de outra.
    const linhaAltura = screen.getByRole("row", { name: /^Altura total/ });
    expect(within(linhaAltura).getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: "Inspeção anterior" })).toBeInTheDocument();
  });
});

describe("visão geral", () => {
  it("indicador sem base aparece como “Sem dados”, não como zero", async () => {
    await abrir("/visao-geral");
    const cartao = (await screen.findByText("Espécie confirmada")).closest(".rounded-xl")!;
    expect(within(cartao as HTMLElement).getByText("Sem dados")).toBeInTheDocument();
    const validas = screen.getByText("Árvores com registro válido").closest(".rounded-xl")!;
    expect(within(validas as HTMLElement).getByText("0")).toBeInTheDocument();
  });

  it("pendências levam à lista filtrada e o gráfico mensal tem tabela equivalente", async () => {
    const usuario = userEvent.setup();
    await abrir("/visao-geral");
    const pendencia = await screen.findByRole("link", { name: /Ocorrências com prazo vencido/ });
    const destino = new URL(pendencia.getAttribute("href")!, "http://x");
    expect(destino.pathname).toBe("/ocorrencias");
    expect(JSON.parse(destino.searchParams.get("atrasadas")!)).toBe("true");
    await usuario.click(screen.getByRole("button", { name: "Ver em tabela" }));
    const tabela = screen.getByRole("table");
    expect(within(tabela).getByText("dez/25")).toBeInTheDocument();
    expect(within(tabela).getAllByRole("row")).toHaveLength(3);
  });
});

describe("visão geral: período e comparação (C-06, C-07)", () => {
  it("preenche De/até com o período vigente e oferece atalhos", async () => {
    const usuario = userEvent.setup();
    await abrir("/visao-geral");
    await screen.findByText("Espécie confirmada");
    const br = /^\d{2}\/\d{2}\/\d{4}$/;
    const iso = (v: string) => v.split("/").reverse().join("-");
    const [de, ate] = screen.getAllByDisplayValue(br) as HTMLInputElement[];
    expect(de!.value).toMatch(br);
    expect(ate!.value).toMatch(br);
    const grupo = screen.getByRole("group", { name: "Atalhos de período" });
    await usuario.click(within(grupo).getByRole("button", { name: "12 meses" }));
    await vi.waitFor(() => {
      const [inicio, fim] = screen.getAllByDisplayValue(br) as HTMLInputElement[];
      const dias = (Date.parse(iso(fim!.value)) - Date.parse(iso(inicio!.value))) / 86_400_000;
      expect(dias).toBe(365);
    });
  });

  it("a comparação diz, em texto, se melhorou ou piorou e qual é a data-base", async () => {
    servidor.use(
      http.get(`${API}/api/v1/indicadores/painel`, () =>
        HttpResponse.json({
          periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
          filtros: { bairro: null, equipe: null },
          calculado_em: "2026-10-31T12:00:00Z",
          indicadores: [
            {
              id: "tempo_atendimento",
              nome: "Tempo médio de atendimento",
              definicao: "d",
              formula: "f",
              valor: 7,
              base: null,
              unidade: "dias",
              periodo: "selecionado",
              fonte: "Registros da plataforma",
              link: null,
              anterior: 5,
              anterior_em: "2026-09-01",
              serie: [],
            },
            {
              id: "cobertura_inspecao",
              nome: "Inspecionadas nos últimos 12 meses",
              definicao: "d",
              formula: "f",
              valor: 10,
              base: 100,
              unidade: "%",
              periodo: "instantâneo",
              fonte: "Registros da plataforma",
              link: null,
              anterior: null,
              anterior_em: null,
              serie: [],
            },
          ],
          distribuicoes: {},
          series_mensais: { meses: [], definicao: "", series: [] },
          pendencias: [],
          equipes: [],
          atividades: [],
        }),
      ),
    );
    await abrir("/visao-geral");
    expect(await screen.findByText(/^\+2 dias desde 01\/09\/26/)).toBeInTheDocument();
    // O julgamento continua em texto (leitor de tela), fora da face visual.
    expect(screen.getByText(", piorou")).toBeInTheDocument();
    // Janela fixa declarada em "Como é calculado" (R2-02), não na face do cartão.
    expect(screen.getByText("Janela: fixa de 12 meses (ignora o período)")).toBeInTheDocument();
  });
});

describe("contexto de fontes externas", () => {
  const painelComContexto = (contexto: unknown[]) =>
    http.get(`${API}/api/v1/indicadores/painel`, () =>
      HttpResponse.json({
        periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
        filtros: { bairro: null, equipe: null },
        calculado_em: "2026-10-31T12:00:00Z",
        indicadores: [],
        contexto_externo: contexto,
        distribuicoes: {},
        series_mensais: { meses: [], definicao: "", series: [] },
        pendencias: [],
        equipes: [],
        atividades: [],
      }),
    );

  it("mostra o cartão do Censo 2022 com fonte, datas e definição, separado da operação", async () => {
    const usuario = userEvent.setup();
    servidor.use(
      painelComContexto([
        {
          id: "arborizacao_faces_com_arvore",
          nome: "Faces de quadra com árvores (Censo 2022)",
          valor: 50.39,
          numerador: 45428,
          base: 90153,
          unidade: "%",
          fonte: "IBGE, Censo Demográfico 2022",
          fonte_url: "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/",
          licenca: "Não declarada no FTP do IBGE",
          data_referencia: "2022-07-31",
          ingerido_em: "2026-11-11T10:00:00Z",
          definicao: "Percentual das faces de quadra com ao menos uma árvore.",
          metodo: "Numerador = V05431 + V05432 + V05433.",
          bairros_com_dado: 121,
          bairros_no_escopo: 121,
        },
      ]),
    );
    await abrir("/visao-geral");
    const secao = (
      await screen.findByRole("heading", { name: "Contexto (fontes externas)" })
    ).closest("section")!;
    const cartao = within(secao).getByRole("article", {
      name: "Faces de quadra com árvores (Censo 2022)",
    });
    expect(within(cartao).getByText("50,4%")).toBeInTheDocument();
    expect(within(cartao).getByText(/45\.428 de 90\.153 faces de quadra/)).toBeInTheDocument();
    expect(
      within(cartao).getByRole("link", { name: "IBGE, Censo Demográfico 2022" }),
    ).toHaveAttribute("href", "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/");
    expect(within(cartao).getByText(/referência: 2022/)).toBeInTheDocument();
    await usuario.click(within(cartao).getByText("Como é calculado").closest("summary")!);
    expect(within(cartao).getByText(/ao menos uma árvore/)).toBeVisible();
    expect(within(cartao).getByText(/Método: Numerador/)).toBeVisible();
  });

  it("sem dado externo a seção não aparece", async () => {
    servidor.use(painelComContexto([]));
    await abrir("/visao-geral");
    await screen.findByRole("heading", { name: "Visão geral" });
    expect(screen.queryByText("Contexto (fontes externas)")).toBeNull();
  });
});

describe("tendência dos instantâneos", () => {
  it("mostra variação desde o registro anterior e sparkline acessível", async () => {
    servidor.use(
      http.get(`${API}/api/v1/indicadores/painel`, () =>
        HttpResponse.json({
          periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
          filtros: { bairro: null, equipe: null },
          calculado_em: "2026-10-31T12:00:00Z",
          indicadores: [
            {
              id: "especie_confirmada",
              nome: "Espécie confirmada",
              definicao: "d",
              formula: "f",
              valor: 40,
              base: 10,
              unidade: "%",
              periodo: "instantâneo",
              fonte: "Registros da plataforma",
              link: null,
              anterior: 32.5,
              anterior_em: "2026-09-30",
              serie: [
                { data: "2026-08-31", valor: 30 },
                { data: "2026-09-30", valor: 32.5 },
                { data: "2026-10-30", valor: 40 },
              ],
            },
            {
              id: "arvores_validas",
              nome: "Árvores com registro válido",
              definicao: "d",
              formula: "f",
              valor: 5,
              base: null,
              unidade: "",
              periodo: "instantâneo",
              fonte: "Registros da plataforma",
              link: null,
              anterior: null,
              anterior_em: null,
              serie: [],
            },
          ],
          distribuicoes: {},
          series_mensais: { meses: [], definicao: "", series: [] },
          pendencias: [],
          equipes: [],
          atividades: [],
        }),
      ),
    );
    await abrir("/visao-geral");
    const cartao = (await screen.findByText("Espécie confirmada")).closest(".rounded-xl")!;
    expect(within(cartao as HTMLElement).getByText("+7,5 p.p. desde 30/09/26")).toBeInTheDocument();
    expect(
      within(cartao as HTMLElement).getByRole("img", {
        name: "Tendência: 30% em 31/08/26 a 40% em 30/10/26",
      }),
    ).toBeInTheDocument();
    // Sem série, nada muda: sem variação nem sparkline.
    const outro = screen.getByText("Árvores com registro válido").closest(".rounded-xl")!;
    expect(within(outro as HTMLElement).queryByRole("img")).toBeNull();
    expect(within(outro as HTMLElement).queryByText(/desde \d/)).toBeNull();
  });
});

describe("acessibilidade", () => {
  it("título da aba acompanha a tela e a definição do indicador não depende de hover", async () => {
    const usuario = userEvent.setup();
    await abrir("/visao-geral");
    await screen.findByText("Espécie confirmada");
    expect(document.title).toMatch(/^Visão geral · /);
    const resumos = screen.getAllByText("Como é calculado");
    await usuario.click(resumos[0]!.closest("summary")!);
    expect(resumos[0]!.closest("details")).toHaveAttribute("open");
    expect(screen.getAllByText("Fonte: Registros da plataforma")[0]).toBeVisible();
  });

  it("busca global anuncia a opção ativa com aria-activedescendant", async () => {
    const usuario = userEvent.setup();
    await abrir("/visao-geral");
    const busca = await screen.findByRole("combobox", { name: "Busca global" });
    await usuario.type(busca, "ARV");
    const lista = await screen.findByRole("listbox");
    const opcoes = await within(lista).findAllByRole("option");
    expect(busca).toHaveAttribute("aria-activedescendant", opcoes[0]!.id);
    await usuario.keyboard("{ArrowDown}");
    expect(busca).toHaveAttribute("aria-activedescendant", opcoes[1]!.id);
    expect(opcoes[1]).toHaveAttribute("aria-selected", "true");
  });
});
