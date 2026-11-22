import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SelosDeteccao } from "../componentes/selosDeteccao";
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
vi.mock("maplibre-gl", () => ({ setWorkerUrl: () => undefined, Marker: vi.fn() }));
vi.mock("../mapa/Mapa", async () => ({
  Mapa: (await import("./MapaFalsoComponente")).MapaFalsoComponente,
}));
vi.mock("../paginas/visao-geral/MapaResumo", () => ({ MapaResumo: () => null }));

const API = "http://api.teste";

const REVISOR: Eu = {
  id: "u-r",
  nome: "Rita Revisora",
  email: "rita@itree.teste",
  papeis: ["revisor"],
  permissoes: [
    "mapa.ler",
    "inventario.ler",
    "relatorios.ler",
    "deteccao.ler",
    "deteccao.enviar",
    "deteccao.revisar",
  ],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
} as Eu;

const lote = (extra = {}) => ({
  id: "l-1",
  id_externo: "simulado-video-1",
  projeto_origem: "simulador-itree",
  versao_modelo: "simulador (dados sintéticos)",
  sensor: "video_rua",
  sensor_rotulo: "Vídeo de rua",
  capturado_em: "2026-11-20",
  canal: "api",
  arquivo_nome: "",
  situacao: "concluido",
  situacao_rotulo: "Concluído",
  total: 30,
  processadas: 30,
  arvores_criadas: 8,
  arvores_juntadas: 19,
  recusadas: 2,
  pontos_criados: 3,
  possiveis_remocoes: 1,
  enviado_por_nome: "Integração: Simulador",
  integracao_nome: "Simulador",
  erro: "",
  criado_em: "2026-11-20T10:00:00Z",
  processado_em: "2026-11-20T10:00:05Z",
  ...extra,
});

const arvore = (extra = {}) => ({
  id: "a-1",
  codigo: "ARV-000001",
  especie: null,
  especie_estado: "nao_identificada",
  especie_texto_original: "",
  localizacao: { longitude: -38.5, latitude: -3.7 },
  localizacao_origem: "detectada",
  precisao_m: 2,
  endereco: "",
  bairro: { id: "b", nome: "Aldeota" },
  situacao: "ativa",
  valida: true,
  origem_registro: "deteccao_satelite",
  deteccao: "satelite",
  confirmada: false,
  confianca: 0.3,
  faixa_confianca: "baixa",
  ultima_vez_vista_em: "2026-11-20T12:00:00Z",
  ocorrencias_abertas: 0,
  condicao_aparente: "",
  condicao_aparente_em: null,
  ultima_inspecao_em: null,
  criado_em: "2026-11-20T12:00:00Z",
  atualizado_em: "2026-11-20T12:00:00Z",
  identificadores: [],
  medidas_atuais: [],
  fundida_em: null,
  motivo_situacao: "",
  lote: null,
  criado_por_nome: "",
  observacoes: "",
  especie_cartao: null,
  em_area_verde: null,
  poste_mais_proximo: null,
  ...extra,
});

let confirmadaPost = 0;
let consultasPainel: string[] = [];
const sinal = {
  id: "s-1",
  situacao: "pendente",
  arvore_id: "a-9",
  arvore_codigo: "ARV-000009",
  arvore_origem: "importacao",
  arvore_confirmada: true,
  especie: "Licania tomentosa",
  bairro: { id: "b", nome: "Aldeota" },
  localizacao: { longitude: -38.5, latitude: -3.7 },
  lote_id: "l-1",
  lote_id_externo: "simulado-video-1",
  lote_capturado_em: "2026-11-20",
  lote_sensor: "video_rua",
  ultima_vez_vista_em: "2026-10-01T12:00:00Z",
  decidido_em: null,
  motivo: "",
  criado_em: "2026-11-20T10:00:05Z",
};
const decisoes: unknown[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(REVISOR)),
  http.get(`${API}/api/v1/deteccoes/lotes`, () =>
    HttpResponse.json({
      count: 2,
      next: null,
      previous: null,
      results: [
        lote(),
        lote({ id: "l-2", id_externo: "s-1", sensor: "satelite", situacao: "em_processamento" }),
      ],
    }),
  ),
  http.get(`${API}/api/v1/deteccoes/lotes/l-1`, () =>
    HttpResponse.json(
      lote({
        erros: [{ id: "d-7", motivo: "foto sem 'anonimizada: true'" }],
        area_coberta: null,
        total_grupos: 29,
      }),
    ),
  ),
  http.get(`${API}/api/v1/deteccoes/lotes/l-1/mapa`, () =>
    HttpResponse.json({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-38.5, -3.7] },
          properties: { resultado: "criada" },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-38.51, -3.7] },
          properties: { resultado: "criada" },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-38.52, -3.7] },
          properties: { resultado: "recusada" },
        },
      ],
    }),
  ),
  http.get(`${API}/api/v1/deteccoes/remocoes`, () =>
    HttpResponse.json({ count: 1, next: null, previous: null, results: [sinal] }),
  ),
  http.post(`${API}/api/v1/deteccoes/remocoes/s-1/confirmar`, async ({ request }) => {
    decisoes.push(await request.json());
    return HttpResponse.json({ ...sinal, situacao: "remocao_confirmada" });
  }),
  http.get(`${API}/api/v1/arvores/a-1`, () => HttpResponse.json(arvore())),
  http.get(`${API}/api/v1/arvores/a-1/observacoes`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/arvores/a-1/fotos`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/evidencias`, () => HttpResponse.json([])),
  http.post(`${API}/api/v1/arvores/a-1/confirmar`, () => {
    confirmadaPost += 1;
    return HttpResponse.json(arvore({ confirmada: true }));
  }),
  http.get(`${API}/api/v1/indicadores/painel`, ({ request }) => {
    consultasPainel.push(new URL(request.url).search);
    return HttpResponse.json({
      periodo: { inicio: "2026-10-22", fim: "2026-11-21" },
      filtros: {},
      calculado_em: "2026-11-21T12:00:00Z",
      indicadores: [
        {
          id: "arvores_validas",
          nome: "Árvores com registro válido",
          definicao: "d",
          formula: "f",
          valor: 5,
          base: null,
          unidade: "",
          periodo: "instantâneo",
          fonte: "x",
          link: null,
          total: 5,
          confirmadas: 2,
        },
      ],
      contexto_externo: [],
      distribuicoes: {},
      series_mensais: { meses: [], definicao: "", series: [] },
      pendencias: [],
      bairros_atencao: {
        titulo: "Bairros que pedem atenção",
        definicao: "",
        formula: "",
        itens: [],
      },
      equipes: [],
      atividades: [],
    });
  }),
  http.get(`${API}/api/v1/territorios`, () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  http.get(`${API}/api/v1/equipes`, () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  http.get(`${API}/api/v1/implantacao/primeiros-passos`, () =>
    HttpResponse.json({ passos: [], concluido: true }),
  ),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "warn" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  confirmadaPost = 0;
  consultasPainel = [];
  decisoes.length = 0;
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

describe("selos da detecção", () => {
  it("mostra origem, estado e confiança só em árvore detectada e não confirmada", () => {
    render(
      <SelosDeteccao
        arvore={{ deteccao: "satelite", confirmada: false, faixa_confianca: "media" }}
      />,
    );
    expect(screen.getByText("Via satélite")).toBeInTheDocument();
    expect(screen.getByText("Não confirmada")).toBeInTheDocument();
    expect(screen.getByText("Confiança média")).toBeInTheDocument();
  });

  it("confirmada mantém a origem e some com a confiança; árvore comum não mostra nada", () => {
    const { container, rerender } = render(
      <SelosDeteccao
        arvore={{ deteccao: "video_rua", confirmada: true, faixa_confianca: "alta" }}
      />,
    );
    expect(screen.getByText("Via vídeo de rua")).toBeInTheDocument();
    expect(screen.getByText("Confirmada")).toBeInTheDocument();
    expect(screen.queryByText(/Confiança/)).toBeNull();
    rerender(<SelosDeteccao arvore={{ deteccao: "", confirmada: true }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Inventário > Detecções", () => {
  it("lista os lotes com situação e contagens", async () => {
    await abrir("/inventario/deteccoes");
    const linha = within(
      (await screen.findByRole("link", { name: "simulado-video-1" })).closest("tr")!,
    );
    expect(linha.getByText("Concluído")).toBeInTheDocument();
    expect(linha.getByText("Via vídeo de rua")).toBeInTheDocument();
    expect(linha.getByText("8")).toBeInTheDocument();
    expect(linha.getByText("19")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Lotes recebidos" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Em processamento")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar pacote/ })).toBeInTheDocument();
  });

  it("abre o detalhe com contagens, mapa por resultado e recusas", async () => {
    await abrir("/inventario/deteccoes/l-1");
    expect(
      await screen.findByRole("heading", { name: "Lote simulado-video-1" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/foto sem 'anonimizada: true'/)).toBeInTheDocument();
    const legenda = await screen.findByLabelText("Legenda do mapa do lote");
    expect(
      within(legenda)
        .getByText(/Árvore criada/)
        .closest("li"),
    ).toHaveTextContent("2");
    expect(
      within(legenda)
        .getByText(/Recusada/)
        .closest("li"),
    ).toHaveTextContent("1");
    expect(screen.getByText(/não informou a área coberta/)).toBeInTheDocument();
  });

  it("revisa possível remoção com justificativa", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/deteccoes?aba=remocoes");
    await screen.findByText("ARV-000009");
    await usuario.click(screen.getByRole("button", { name: "Confirmar remoção" }));
    const dialogo = await screen.findByRole("dialog");
    const botao = within(dialogo).getByRole("button", { name: "Confirmar remoção" });
    expect(botao).toBeDisabled();
    await usuario.type(within(dialogo).getByLabelText(/Justificativa/), "Vistoria confirmou");
    await usuario.click(botao);
    await waitFor(() => expect(decisoes).toEqual([{ motivo: "Vistoria confirmou" }]));
  });
});

describe("ficha da árvore detectada", () => {
  it("mostra os selos e confirma a árvore", async () => {
    const usuario = userEvent.setup();
    await abrir("/inventario/arvores/a-1");
    expect(await screen.findAllByText("Via satélite")).not.toHaveLength(0);
    expect(screen.getAllByText("Não confirmada").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Confiança baixa").length).toBeGreaterThan(0);
    await usuario.click(screen.getByRole("button", { name: /Confirmar árvore/ }));
    const dialogo = await screen.findByRole("dialog");
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar árvore" }));
    await waitFor(() => expect(confirmadaPost).toBe(1));
  });
});

describe("filtro Contar: todas | só confirmadas", () => {
  it("mostra N árvores (M confirmadas) e leva a escolha para a API e para a URL", async () => {
    const usuario = userEvent.setup();
    await abrir("/visao-geral");
    expect(await screen.findByTestId("contagem-total-confirmadas")).toHaveTextContent(
      "5 árvores (2 confirmadas)",
    );
    expect(consultasPainel[0]).not.toContain("contagem");
    await usuario.click(screen.getByRole("button", { name: "Só confirmadas" }));
    await waitFor(() =>
      expect(consultasPainel.some((q) => q.includes("contagem=confirmadas"))).toBe(true),
    );
    expect(screen.getByRole("button", { name: "Só confirmadas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("lê a escolha da URL", async () => {
    await abrir("/visao-geral?contagem=confirmadas");
    await screen.findByTestId("contagem-total-confirmadas");
    expect(consultasPainel.every((q) => q.includes("contagem=confirmadas"))).toBe(true);
  });
});
