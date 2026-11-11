import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { mapasCriados, type MapaFalso } from "./mapaFalso";

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
// O MapLibre precisa de WebGL, ausente no jsdom: a tela usa um mapa falso.
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

const LEITOR: Eu = {
  id: "u-l",
  nome: "Lia Leitora",
  email: "lia@itree.teste",
  papeis: ["consulta"],
  permissoes: ["mapa.ler", "inventario.ler", "ocorrencias.ler"],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};
const COORDENADOR: Eu = {
  ...LEITOR,
  id: "u-c",
  nome: "Caio Coordenador",
  papeis: ["coordenador"],
  permissoes: [...LEITOR.permissoes, "tarefas.ler", "tarefas.editar", "relatorios.exportar"],
};
let eu: Eu = LEITOR;

const SELECAO = {
  area_km2: 1.25,
  limite_itens: 2000,
  limite_tarefas_em_lote: 1000,
  arvores: {
    total: 2,
    por_condicao: { boa: 1, ruim: 1 },
    itens: [
      {
        id: "a-1",
        codigo: "ARV-000001",
        especie: "Licania tomentosa",
        condicao: "boa",
        endereco: "Rua 1",
      },
      { id: "a-2", codigo: "ARV-000002", especie: "", condicao: "ruim", endereco: "" },
    ],
    truncado: false,
  },
  ocorrencias: {
    total: 1,
    itens: [
      {
        id: "o-1",
        codigo: "OCO-000001",
        tipo: "Galho caído",
        estado: "aberta",
        prioridade: "alta",
        risco_confirmado: false,
      },
    ],
    truncado: false,
  },
};

let resposta: () => Response = () => HttpResponse.json(SELECAO);
const pedidosSelecao: Record<string, unknown>[] = [];
const pedidosLote: Record<string, unknown>[] = [];
const pedidosExportacao: Record<string, unknown>[] = [];

const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/mapa/camadas`, () =>
    HttpResponse.json({
      territorios: [],
      arvores: { total: 2, sem_localizacao: 0, atualizado_em: null },
      ocorrencias: { abertas: 1, atualizado_em: null },
      limites_escopo: null,
    }),
  ),
  http.get(`${API}/api/v1/territorios/geojson`, () =>
    HttpResponse.json({ type: "FeatureCollection", features: [] }),
  ),
  http.post(`${API}/api/v1/mapa/selecao`, async ({ request }) => {
    pedidosSelecao.push((await request.json()) as Record<string, unknown>);
    return resposta();
  }),
  http.get(`${API}/api/v1/equipes`, () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  http.post(`${API}/api/v1/tarefas/lote`, async ({ request }) => {
    pedidosLote.push((await request.json()) as Record<string, unknown>);
    return HttpResponse.json(
      { criadas: 2, ignoradas: 0, fora_do_escopo_do_responsavel: 0 },
      { status: 201 },
    );
  }),
  http.post(`${API}/api/v1/mapa/selecao/exportar`, async ({ request }) => {
    pedidosExportacao.push((await request.json()) as Record<string, unknown>);
    return new HttpResponse("codigo\nARV-000001\n", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="itree-arvores.csv"',
      },
    });
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
  URL.createObjectURL = vi.fn(() => "blob:teste");
  URL.revokeObjectURL = vi.fn();
});
beforeEach(() => {
  mapasCriados.length = 0;
  eu = LEITOR;
  resposta = () => HttpResponse.json(SELECAO);
});
afterEach(() => {
  servidor.resetHandlers();
  pedidosSelecao.length = 0;
  pedidosLote.length = 0;
  pedidosExportacao.length = 0;
  vi.restoreAllMocks();
});
afterAll(() => servidor.close());

async function abrirMapa(caminho = "/mapa") {
  const { criarRoteador } = await import("../rotas");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={criarRoteador(createMemoryHistory({ initialEntries: [caminho] }))} />
    </QueryClientProvider>,
  );
  await screen.findByRole("region", { name: "Mapa de árvores e ocorrências" }, { timeout: 3000 });
  return vi.waitFor(() => {
    expect(mapasCriados).toHaveLength(1);
    return mapasCriados[0]!;
  });
}

const ev = (lng: number, lat: number, x: number, y: number) => ({
  lngLat: { lng, lat },
  point: { x, y },
  originalEvent: { button: 0 },
});

/** Arrasta um retângulo no mapa. */
function desenharRetangulo(mapa: MapaFalso) {
  act(() => {
    mapa.emitir("mousedown", ev(-38.56, -3.76, 10, 10));
    mapa.emitir("mousemove", ev(-38.55, -3.75, 80, 80));
    mapa.emitir("mouseup", ev(-38.55, -3.75, 80, 80));
  });
}

async function selecionarArea(usuario: ReturnType<typeof userEvent.setup>, mapa: MapaFalso) {
  await usuario.click(await screen.findByRole("button", { name: "Selecionar área" }));
  desenharRetangulo(mapa);
  return screen.findByRole("complementary", { name: "Seleção por área" });
}

describe("seleção por área no mapa (RF-MAPA-022)", () => {
  it("anuncia o modo, desenha o retângulo e lista o que há dentro", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    const botao = await screen.findByRole("button", { name: "Selecionar área" });
    expect(botao).toHaveAttribute("aria-pressed", "false");

    await usuario.click(botao);
    expect(botao).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/Arraste no mapa.*Esc sai do modo/);

    desenharRetangulo(mapa);
    const painel = await screen.findByRole("complementary", { name: "Seleção por área" });
    expect(await within(painel).findByText("ARV-000001")).toBeInTheDocument();
    expect(within(painel).getByText(/1,25 km²/)).toBeInTheDocument();
    // Resumo por condição e ocorrências.
    const itensCondicao = within(painel)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(itensCondicao).toEqual(expect.arrayContaining(["Boa: 1", "Ruim: 1"]));
    expect(within(painel).getByText("OCO-000001")).toBeInTheDocument();
    // Links para o detalhe.
    expect(within(painel).getByRole("link", { name: /ARV-000002/ })).toHaveAttribute(
      "href",
      "/inventario/arvores/a-2",
    );
    expect(within(painel).getByRole("link", { name: /OCO-000001/ })).toHaveAttribute(
      "href",
      "/ocorrencias/o-1",
    );
    // A área fica desenhada enquanto o painel está aberto.
    expect(mapa.dadosDe("area-selecao").features).toHaveLength(1);
    expect(mapa.camadas.find((c) => c.id === "area-selecao-contorno")).toBeDefined();
    // O modo de desenho terminou.
    expect(botao).toHaveAttribute("aria-pressed", "false");
    // O pedido leva a geometria desenhada e os filtros ativos.
    expect(pedidosSelecao[0]).toMatchObject({
      geometria: { type: "Polygon" },
      filtros: { estado: "abertas" },
      camadas: ["arvores", "ocorrencias"],
    });
  });

  it("repassa os filtros e as camadas ativas do mapa", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa(
      "/mapa?condicao_aparente=ruim&sem_inspecao_dias=365&ocorrencias=0",
    );
    await selecionarArea(usuario, mapa);
    await vi.waitFor(() => expect(pedidosSelecao).toHaveLength(1));
    expect(pedidosSelecao[0]).toMatchObject({
      filtros: { condicao_aparente: "ruim", sem_inspecao_dias: "365", estado: "abertas" },
      camadas: ["arvores"],
    });
  });

  it("Esc sai do modo de desenho e fechar o painel limpa a área", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    const botao = await screen.findByRole("button", { name: "Selecionar área" });
    await usuario.click(botao);
    await usuario.keyboard("{Escape}");
    expect(botao).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/Esc sai do modo/)).not.toBeInTheDocument();

    const painel = await selecionarArea(usuario, mapa);
    await within(painel).findByText("ARV-000001");
    await usuario.click(within(painel).getByRole("button", { name: "Fechar seleção por área" }));
    expect(screen.queryByRole("complementary", { name: "Seleção por área" })).toBeNull();
    expect(mapa.dadosDe("area-selecao").features).toEqual([]);
    expect(botao).toHaveFocus();
  });

  it("o painel abre com o foco e fecha com Esc pelo teclado", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    const painel = await selecionarArea(usuario, mapa);
    expect(within(painel).getByRole("heading", { name: "Seleção por área" })).toHaveFocus();
    await usuario.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Seleção por área" })).toBeNull();
  });

  it("sem o mouse, seleciona a área visível do mapa", async () => {
    const usuario = userEvent.setup();
    await abrirMapa();
    await usuario.click(await screen.findByRole("button", { name: "Selecionar área" }));
    await usuario.click(screen.getByRole("button", { name: "Usar área visível" }));
    await screen.findByRole("complementary", { name: "Seleção por área" });
    await vi.waitFor(() => expect(pedidosSelecao).toHaveLength(1));
    expect((pedidosSelecao[0]!.geometria as { coordinates: number[][][] }).coordinates[0]).toEqual([
      [-38.6, -3.8],
      [-38.4, -3.8],
      [-38.4, -3.6],
      [-38.6, -3.6],
      [-38.6, -3.8],
    ]);
  });

  it("avisa quando a lista foi cortada e mostra o erro da API", async () => {
    const usuario = userEvent.setup();
    resposta = () =>
      HttpResponse.json({
        ...SELECAO,
        arvores: { ...SELECAO.arvores, total: 2500, truncado: true },
      });
    const mapa = await abrirMapa();
    const painel = await selecionarArea(usuario, mapa);
    expect(await within(painel).findByRole("note")).toHaveTextContent(
      /primeiros 2\.000 itens.*seleção inteira/,
    );

    resposta = () =>
      HttpResponse.json(
        { geometria: ["A área tem 1500 km²; o máximo é 1000 km²."] },
        { status: 400 },
      );
    await usuario.click(within(painel).getByRole("button", { name: "Fechar seleção por área" }));
    const painel2 = await selecionarArea(usuario, mapa);
    expect(await within(painel2).findByRole("alert")).toHaveTextContent(/o máximo é 1000 km²/);
  });

  it("sem permissão, as ações de criar tarefas e exportar não aparecem", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    const painel = await selecionarArea(usuario, mapa);
    await within(painel).findByText("ARV-000001");
    expect(within(painel).queryByRole("button", { name: /Criar tarefas/ })).toBeNull();
    expect(within(painel).queryByRole("button", { name: /Exportar/ })).toBeNull();
  });

  it("cria tarefas em lote para as árvores da área", async () => {
    eu = COORDENADOR;
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    const painel = await selecionarArea(usuario, mapa);
    await usuario.click(
      await within(painel).findByRole("button", { name: "Criar tarefas (2 árvores)" }),
    );
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/para 2 árvores/)).toBeInTheDocument();
    await usuario.click(within(dialogo).getByRole("button", { name: "Criar" }));
    await vi.waitFor(() =>
      expect(pedidosLote).toEqual([
        expect.objectContaining({ arvore_ids: ["a-1", "a-2"], equipe_id: null }),
      ]),
    );
    expect(await within(dialogo).findByText(/tarefas criadas/)).toBeInTheDocument();
  });

  it("não deixa criar tarefas acima do limite do lote", async () => {
    eu = COORDENADOR;
    resposta = () =>
      HttpResponse.json({ ...SELECAO, arvores: { ...SELECAO.arvores, total: 1200 } });
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    const painel = await selecionarArea(usuario, mapa);
    const botao = await within(painel).findByRole("button", { name: /Criar tarefas/ });
    expect(botao).toBeDisabled();
    expect(within(painel).getByText(/limite é de 1\.000 árvores por lote/)).toBeInTheDocument();
  });

  it("exporta a seleção com a geometria e os filtros", async () => {
    eu = COORDENADOR;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const usuario = userEvent.setup();
    const mapa = await abrirMapa("/mapa?condicao_aparente=ruim");
    const painel = await selecionarArea(usuario, mapa);
    await usuario.click(
      await within(painel).findByRole("button", {
        name: "Exportar árvores da seleção em CSV",
      }),
    );
    await vi.waitFor(() => expect(pedidosExportacao).toHaveLength(1));
    expect(pedidosExportacao[0]).toMatchObject({
      conjunto: "arvores",
      formato: "csv",
      geometria: { type: "Polygon" },
      filtros: { condicao_aparente: "ruim", estado: "abertas" },
    });
    expect(
      within(painel).getByRole("button", { name: "Exportar ocorrências da seleção em GeoJSON" }),
    ).toBeInTheDocument();
  });
});

describe("painel da árvore e controles do mapa (C-09, C-10, C-11, C-12)", () => {
  const ARVORE = {
    id: "a-1",
    codigo: "ARV-000001",
    especie: null,
    especie_texto_original: "",
    especie_estado: "nao_identificada",
    localizacao_origem: "importada",
    precisao_m: null,
    endereco: "Rua 1",
    bairro: null,
    medidas_atuais: [],
    ocorrencias_abertas: 0,
    situacao: "ativa",
    localizacao: { longitude: -38.5, latitude: -3.7 },
    condicao_aparente: "ruim",
    condicao_aparente_em: "2026-10-01",
  };
  const comArvore = (evidencias: unknown[]) =>
    servidor.use(
      http.get(`${API}/api/v1/arvores/a-1`, () => HttpResponse.json(ARVORE)),
      http.get(`${API}/api/v1/evidencias`, () => HttpResponse.json(evidencias)),
    );

  it("mostra a condição validada, o placeholder sem foto e os atalhos de ação", async () => {
    eu = { ...COORDENADOR, permissoes: [...COORDENADOR.permissoes, "ocorrencias.editar"] };
    comArvore([]);
    await abrirMapa("/mapa?selecao=arvore:a-1");
    const painel = await screen.findByRole("complementary", { name: "Detalhes da seleção" });
    expect(await within(painel).findByText("ARV-000001")).toBeInTheDocument();
    // Não diz mais "sem avaliação" para uma árvore com condição validada.
    expect(within(painel).getByText("Ruim")).toBeInTheDocument();
    expect(within(painel).queryByText("Sem avaliação registrada.")).toBeNull();
    expect(await within(painel).findByRole("img", { name: "Árvore sem foto" })).toBeInTheDocument();
    expect(
      within(painel).getByRole("button", { name: /Registrar ocorrência/ }),
    ).toBeInTheDocument();
    await userEvent.click(within(painel).getByRole("button", { name: /Pedir inspeção/ }));
    expect(
      await screen.findByRole("dialog", { name: /Tarefa de inspeção para ARV-000001/ }),
    ).toBeInTheDocument();
  });

  it("a foto traz legenda com autoria e data; leitor não vê os atalhos de ação", async () => {
    comArvore([
      {
        id: "e-1",
        nome_original: "arvore.png",
        eh_imagem: true,
        url: "http://x/foto.png",
        descricao: "",
        enviada_por_nome: "Ana Campo",
        capturada_em: null,
        criado_em: "2026-10-05T12:00:00Z",
      },
    ]);
    await abrirMapa("/mapa?selecao=arvore:a-1");
    const painel = await screen.findByRole("complementary", { name: "Detalhes da seleção" });
    expect(await within(painel).findByText(/Foto enviada por Ana Campo em/)).toBeInTheDocument();
    expect(within(painel).queryByRole("button", { name: /Pedir inspeção/ })).toBeNull();
  });

  const FOTO = {
    id: "e-1",
    nome_original: "arvore.png",
    eh_imagem: true,
    url: "http://x/foto.png",
    descricao: "",
    enviada_por_nome: "Ana Campo",
    capturada_em: null,
    criado_em: "2026-10-05T12:00:00Z",
  };

  it("foto ilustrativa leva o selo Ilustração no painel", async () => {
    comArvore([{ ...FOTO, ilustrativa: true }]);
    await abrirMapa("/mapa?selecao=arvore:a-1");
    const painel = await screen.findByRole("complementary", { name: "Detalhes da seleção" });
    expect(await within(painel).findByText("Ilustração")).toBeInTheDocument();
  });

  it("foto real não leva o selo Ilustração", async () => {
    comArvore([{ ...FOTO, ilustrativa: false }]);
    await abrirMapa("/mapa?selecao=arvore:a-1");
    const painel = await screen.findByRole("complementary", { name: "Detalhes da seleção" });
    expect(await within(painel).findByText(/Foto enviada por Ana Campo/)).toBeInTheDocument();
    expect(within(painel).queryByText("Ilustração")).toBeNull();
  });

  it("legenda começa recolhida com o painel aberto e camada desligada avisa que está oculta", async () => {
    const usuario = userEvent.setup();
    await abrirMapa("/mapa?ocorrencias=0");
    const legenda = await screen.findByRole("button", { name: "Legenda" });
    expect(legenda).toHaveAttribute("aria-expanded", "false");
    expect(await screen.findByText(/1 abertas · oculta no mapa/)).toBeInTheDocument();
    await usuario.click(legenda);
    expect(legenda).toHaveAttribute("aria-expanded", "true");
  });
});
