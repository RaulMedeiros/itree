import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { criarServidor } from "./servidorPadrao";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { COR_POR_VALOR, ROTULOS_CLASSES_ARBORIZACAO } from "../mapa/coropletica";
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

const GESTOR: Eu = {
  id: "u-g",
  nome: "Gil Gestor",
  email: "gil@itree.teste",
  papeis: ["gestor"],
  permissoes: ["mapa.ler", "inventario.ler"],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const BAIRRO = {
  type: "Feature",
  id: "b-1",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-38.56, -3.76],
        [-38.55, -3.76],
        [-38.55, -3.75],
        [-38.56, -3.75],
        [-38.56, -3.76],
      ],
    ],
  },
  properties: { nome: "Meireles", tipo: "bairro" },
};

/** Praça e unidade de conservação do dado real do Fortaleza em Mapas (mapas 99 e 737). */
const AREAS_VERDES = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "av-1",
      geometry: BAIRRO.geometry,
      properties: {
        nome: "Largo do Mercado",
        nome_popular: "Praça dos Correios",
        tipo: "praca",
        tipo_rotulo: "Praça",
        orgao_gestor: "UrbFor",
        esfera: "Municipal",
        ato_legal: "",
        area_m2: 1234.5,
        fonte: "Fortaleza em Mapas (Ipplan Fortaleza): Praças de Fortaleza, URBFOR",
        licenca:
          "Termos da API do Fortaleza em Mapas: uso livre, com citação obrigatória da fonte.",
        data_referencia: "2019-01-01",
        ingerido_em: "2026-11-11T12:00:00Z",
      },
    },
    {
      type: "Feature",
      id: "av-2",
      geometry: BAIRRO.geometry,
      properties: {
        nome: "ARIE Prof. Abreu Matos",
        nome_popular: "",
        tipo: "unidade_conservacao",
        tipo_rotulo: "Unidade de conservação",
        orgao_gestor: "SEUMA",
        esfera: "Municipal",
        ato_legal: "LEI N° 10.463, DE 31 DE MARÇO DE 2016",
        area_m2: 188371.5,
        fonte: "Fortaleza em Mapas (Ipplan Fortaleza): Unidades de Conservação, SEUMA e CEUC/SEMA",
        licenca:
          "Termos da API do Fortaleza em Mapas: uso livre, com citação obrigatória da fonte.",
        data_referencia: "2023-01-01",
        ingerido_em: "2026-11-11T12:00:00Z",
      },
    },
  ],
};
const consultasAreasVerdes: URL[] = [];
let situacaoFonteAreasVerdes: Record<string, unknown> = {
  ultima_importacao: "2026-11-01T04:00:00Z",
  dias: 10,
  limite_dias: 60,
  desatualizada: false,
};

const servidor = criarServidor(
  http.get(`${API}/api/v1/areas-verdes`, ({ request }) => {
    consultasAreasVerdes.push(new URL(request.url));
    return HttpResponse.json({ ...AREAS_VERDES, situacao_da_fonte: situacaoFonteAreasVerdes });
  }),
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/mapa/camadas`, () =>
    HttpResponse.json({
      territorios: [],
      areas_verdes: [
        {
          tipo: "praca",
          quantidade: 484,
          fontes: ["Fortaleza em Mapas (Ipplan Fortaleza): Praças de Fortaleza, URBFOR"],
          licencas: [
            "Termos da API do Fortaleza em Mapas: uso livre, com citação obrigatória da fonte.",
          ],
          data_referencia_mais_antiga: "2019-01-01",
          ingerido_em: "2026-11-11T12:00:00Z",
        },
      ],
      arvores: { total: 3, sem_localizacao: 0, atualizado_em: null },
      ocorrencias: null,
      limites_escopo: null,
    }),
  ),
  http.get(`${API}/api/v1/territorios/geojson`, () =>
    HttpResponse.json({ type: "FeatureCollection", features: [BAIRRO] }),
  ),
  http.get(`${API}/api/v1/mapa/busca`, ({ request }) => {
    const q = new URL(request.url).searchParams.get("q");
    return HttpResponse.json(
      q === "mei"
        ? [
            {
              tipo: "territorio",
              id: "b-1",
              rotulo: "Meireles",
              descricao: "Bairro",
              localizacao: null,
              limites: [-38.56, -3.76, -38.55, -3.75],
            },
          ]
        : [
            {
              tipo: "coordenada",
              id: null,
              rotulo: "-3.700000, -38.500000",
              descricao: "Coordenada",
              localizacao: { longitude: -38.5, latitude: -3.7 },
              limites: null,
            },
          ],
    );
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
beforeEach(() => {
  mapasCriados.length = 0;
  consultasAreasVerdes.length = 0;
  situacaoFonteAreasVerdes = {
    ultima_importacao: "2026-11-01T04:00:00Z",
    dias: 10,
    limite_dias: 60,
    desatualizada: false,
  };
});
afterEach(() => servidor.resetHandlers());
afterAll(() => servidor.close());

async function abrirMapa(rota = "/mapa") {
  const { criarRoteador } = await import("../rotas");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={criarRoteador(createMemoryHistory({ initialEntries: [rota] }))} />
    </QueryClientProvider>,
  );
  await screen.findByRole("region", { name: "Mapa de árvores e ocorrências" }, { timeout: 3000 });
  return vi.waitFor(() => {
    expect(mapasCriados).toHaveLength(1);
    return mapasCriados[0]!;
  });
}

const feicoesRealcadas = (m: (typeof mapasCriados)[number]) => m.dadosDe("destaque").features;

async function buscarBairro(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.type(screen.getByRole("combobox", { name: "Busca global" }), "mei");
  await usuario.click(await screen.findByRole("option", { name: /Meireles/ }));
}

describe("realce do bairro buscado (RF-MAPA-011)", () => {
  it("destaca o polígono ao escolher o bairro na busca, abaixo do anel da seleção", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    expect(feicoesRealcadas(mapa)).toEqual([]);

    await buscarBairro(usuario);

    expect(await screen.findByText("Bairro em destaque:")).toBeInTheDocument();
    expect(feicoesRealcadas(mapa)).toHaveLength(1);
    expect(feicoesRealcadas(mapa)[0]!.properties.nome).toBe("Meireles");
    expect(mapa.fitBounds).toHaveBeenCalledWith([-38.56, -3.76, -38.55, -3.75], expect.anything());
    // C-39: a máscara esmaece o exterior, abaixo das árvores (que mantêm a cor); o
    // contorno fica abaixo do anel de seleção. Nada tinge o interior do bairro.
    expect(mapa.camadas.find((c) => c.id === "destaque-preenchimento")?.antesDe).toBe(
      "arvores-pontos",
    );
    const mascara = mapa.dadosDe("destaque-mascara").features;
    expect(mascara).toHaveLength(1);
    expect(
      (mascara[0] as unknown as { geometry: { coordinates: unknown[] } }).geometry.coordinates,
    ).toHaveLength(2);
    expect(mapa.camadas.find((c) => c.id === "destaque-contorno")?.antesDe).toBe("selecao");
  });

  it("remove o realce no próximo clique no mapa", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    await buscarBairro(usuario);
    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toHaveLength(1));

    act(() => mapa.emitir("click"));

    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toEqual([]));
    expect(screen.queryByText("Bairro em destaque:")).not.toBeInTheDocument();
  });

  it("remove o realce ao limpar e em uma nova busca", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    await buscarBairro(usuario);
    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toHaveLength(1));

    await usuario.click(screen.getByRole("button", { name: "Limpar destaque do bairro" }));
    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toEqual([]));

    await buscarBairro(usuario);
    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toHaveLength(1));
    await usuario.type(screen.getByRole("combobox", { name: "Busca global" }), "-3.7, -38.5");
    await usuario.click(await screen.findByRole("option", { name: /Coordenada/ }));
    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toEqual([]));
  });
});

describe("seletor de território no cabeçalho", () => {
  const MEIRELES = { id: "b-1", nome: "Meireles", tipo: "bairro" } as const;
  const ALDEOTA = { id: "b-2", nome: "Aldeota", tipo: "bairro" } as const;
  const LIMITES_ESCOPO = [-38.7, -3.9, -38.4, -3.6];

  beforeEach(() => {
    localStorage.clear();
    servidor.use(
      http.get(`${API}/api/v1/eu`, () =>
        HttpResponse.json({ ...GESTOR, territorios: [MEIRELES, ALDEOTA] }),
      ),
      http.get(`${API}/api/v1/mapa/camadas`, () =>
        HttpResponse.json({
          territorios: [],
          arvores: { total: 3, sem_localizacao: 0, atualizado_em: null },
          ocorrencias: null,
          limites_escopo: LIMITES_ESCOPO,
        }),
      ),
    );
  });
  afterEach(() => localStorage.clear());

  it("enquadra e realça o bairro escolhido, como na busca", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa("/mapa?lon=-38.5&lat=-3.7&zoom=12");
    mapa.fitBounds.mockClear();
    expect(feicoesRealcadas(mapa)).toEqual([]);

    await usuario.selectOptions(await screen.findByRole("combobox", { name: "Território" }), "b-1");

    expect(await screen.findByText("Bairro em destaque:")).toBeInTheDocument();
    expect(feicoesRealcadas(mapa)[0]!.properties.nome).toBe("Meireles");
    expect(mapa.fitBounds).toHaveBeenCalledWith([-38.56, -3.76, -38.55, -3.75], expect.anything());
  });

  it("voltar a todo o escopo limpa o realce e enquadra o escopo", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa("/mapa?lon=-38.5&lat=-3.7&zoom=12");
    const seletor = await screen.findByRole("combobox", { name: "Território" });
    await usuario.selectOptions(seletor, "b-1");
    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toHaveLength(1));
    mapa.fitBounds.mockClear();

    await usuario.selectOptions(seletor, "");

    await vi.waitFor(() => expect(feicoesRealcadas(mapa)).toEqual([]));
    expect(mapa.fitBounds).toHaveBeenCalledWith(LIMITES_ESCOPO, expect.anything());
  });

  it("abrir o mapa com um território já escolhido não mexe na câmera", async () => {
    localStorage.setItem("itree:territorio-ativo:u-g", "b-1");
    const mapa = await abrirMapa("/mapa?lon=-38.5&lat=-3.7&zoom=12");
    await screen.findByRole("combobox", { name: "Território" });
    expect(mapa.fitBounds).not.toHaveBeenCalled();
    expect(feicoesRealcadas(mapa)).toEqual([]);
  });
});

describe("arborização do entorno (Censo 2022)", () => {
  const CAMADAS = ["arborizacao-entorno-preenchimento", "arborizacao-entorno-sem-dado"];
  const DADOS = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "b-1",
        geometry: BAIRRO.geometry,
        properties: { nome: "Aldeota", valor: 64.73, faces_com_arvore: 938, faces: 1449 },
      },
      {
        type: "Feature",
        id: "b-3",
        geometry: BAIRRO.geometry,
        properties: { nome: "Sem Censo", valor: null, faces_com_arvore: null, faces: null },
      },
    ],
    proveniencia: {
      id: "arborizacao_faces_com_arvore",
      nome: "Faces de quadra com árvores (Censo 2022)",
      fonte: "IBGE, Censo Demográfico 2022",
      licenca: "Não declarada no FTP do IBGE",
      data_referencia: "2022-07-31",
      ingerido_em: "2026-11-11T12:00:00Z",
      definicao: "Definição vinda da API: faces de quadra com ao menos uma árvore.",
    },
  };
  const pedidos: URL[] = [];

  beforeEach(() => {
    pedidos.length = 0;
    servidor.use(
      http.get(`${API}/api/v1/indicadores/externos/arborizacao-entorno`, ({ request }) => {
        pedidos.push(new URL(request.url));
        return HttpResponse.json(DADOS);
      }),
    );
  });

  it("fica no grupo Contexto (fontes externas), desligada por padrão e sem baixar nada", async () => {
    const mapa = await abrirMapa();
    const grupo = (await screen.findByText("Contexto (fontes externas)")).closest("details")!;
    const caixa = within(grupo).getByRole("checkbox", {
      name: /Arborização do entorno \(Censo 2022\)/,
    });
    expect(caixa).not.toBeChecked();
    expect(within(grupo).getByText(/Fonte: IBGE, Censo 2022/)).toBeInTheDocument();
    expect(pedidos).toHaveLength(0);
    for (const id of CAMADAS)
      expect(mapa.setLayoutProperty).not.toHaveBeenCalledWith(id, "visibility", "visible");
    expect(screen.queryByText("Sem dado")).not.toBeInTheDocument();
  });

  it("pinta por classe com um só matiz e põe o bairro sem dado em hachura própria", async () => {
    const mapa = await abrirMapa();
    const pintura = mapa.camadaDe("arborizacao-entorno-preenchimento")!;
    // Abaixo do contorno dos bairros, que continua por cima.
    expect(pintura.antesDe).toBe("bairros-contorno");
    expect(pintura.paint!["fill-color"]).toEqual(COR_POR_VALOR);
    expect(mapa.camadaDe("arborizacao-entorno-sem-dado")!.paint!["fill-pattern"]).toBe(
      "hachura-sem-dado",
    );
  });

  it("ao ligar, carrega uma vez, mostra a camada e a legenda com fonte e definição", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    await usuario.click(
      await screen.findByRole("checkbox", { name: /Arborização do entorno \(Censo 2022\)/ }),
    );

    await vi.waitFor(() => expect(mapa.dadosDe("arborizacao-entorno").features).toHaveLength(2));
    expect(pedidos).toHaveLength(1);
    // A proveniência não vira feição do mapa.
    expect(
      (mapa.dadosDe("arborizacao-entorno") as unknown as Record<string, unknown>).proveniencia,
    ).toBeUndefined();
    for (const id of CAMADAS)
      expect(mapa.setLayoutProperty).toHaveBeenCalledWith(id, "visibility", "visible");

    const legenda = await screen.findByRole("region", { name: "Legenda" });
    await usuario.click(within(legenda).getByRole("button", { name: "Legenda" }));
    for (const rotulo of ROTULOS_CLASSES_ARBORIZACAO)
      expect(within(legenda).getByText(rotulo)).toBeInTheDocument();
    expect(within(legenda).getByText("Sem dado")).toBeInTheDocument();
    expect(within(legenda).getByText("Fonte: IBGE, Censo 2022.")).toBeInTheDocument();
    expect(await within(legenda).findByText(/Definição vinda da API/)).toBeInTheDocument();

    // Fontes dos dados: órgão, licença, ingestão e ano de referência.
    expect(
      screen.getByText(
        /IBGE, Censo Demográfico 2022 · Não declarada no FTP do IBGE.*dados de 2022/,
      ),
    ).toBeInTheDocument();
  });

  it("desligar esconde a camada e a legenda, sem nova consulta ao religar", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa("/mapa?arborizacao_entorno=1");
    await vi.waitFor(() => expect(pedidos).toHaveLength(1));
    const caixa = await screen.findByRole("checkbox", {
      name: /Arborização do entorno \(Censo 2022\)/,
    });
    expect(caixa).toBeChecked();
    await usuario.click(caixa);
    const visibilidade = () =>
      mapa.setLayoutProperty.mock.calls
        .filter(([id]) => id === "arborizacao-entorno-preenchimento")
        .at(-1)?.[2];
    await vi.waitFor(() => expect(visibilidade()).toBe("none"));
    await usuario.click(caixa);
    await vi.waitFor(() => expect(visibilidade()).toBe("visible"));
    expect(pedidos).toHaveLength(1);
  });

  it("a dica do bairro mostra o percentual e a base, ou diz que não há dado", async () => {
    const mapa = await abrirMapa("/mapa?arborizacao_entorno=1");
    await vi.waitFor(() => expect(pedidos).toHaveLength(1));
    act(() =>
      mapa.emitir(
        "mousemove",
        { point: { x: 5, y: 5 }, features: [{ properties: DADOS.features[0]!.properties }] },
        "arborizacao-entorno-preenchimento",
      ),
    );
    expect(
      await screen.findByText("Aldeota · 64,7% das faces com árvore (938 de 1.449 faces)"),
    ).toBeInTheDocument();
    act(() =>
      mapa.emitir(
        "mousemove",
        { point: { x: 5, y: 5 }, features: [{ properties: DADOS.features[1]!.properties }] },
        "arborizacao-entorno-sem-dado",
      ),
    );
    expect(await screen.findByText("Sem Censo · sem dado do Censo 2022")).toBeInTheDocument();
  });

  it("clicar no bairro abre o painel com percentual, base e toda a proveniência (M-18)", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa("/mapa?arborizacao_entorno=1");
    await vi.waitFor(() => expect(mapa.dadosDe("arborizacao-entorno").features).toHaveLength(2));
    await vi.waitFor(() => expect(pedidos).toHaveLength(1));
    // Espera a proveniência chegar ao estado (a legenda a mostra).
    await screen.findByText(/IBGE, Censo Demográfico 2022 · Não declarada/);

    act(() =>
      mapa.emitir(
        "click",
        { point: { x: 5, y: 5 }, features: [{ properties: DADOS.features[0]!.properties }] },
        "arborizacao-entorno-preenchimento",
      ),
    );
    const painel = await screen.findByRole("complementary", {
      name: "Arborização do entorno do bairro",
    });
    expect(within(painel).getByText("Aldeota")).toBeInTheDocument();
    expect(within(painel).getByText("64,7%")).toBeInTheDocument();
    expect(within(painel).getByText("938 de 1.449 faces")).toBeInTheDocument();
    expect(within(painel).getByText(/Definição vinda da API/)).toBeInTheDocument();
    expect(within(painel).getByText(/Fonte:/).parentElement).toHaveTextContent(
      "IBGE, Censo Demográfico 2022",
    );
    expect(within(painel).getByText(/Licença:/).parentElement).toHaveTextContent(
      "Não declarada no FTP do IBGE",
    );
    expect(within(painel).getByText(/Data de referência:/).parentElement).toHaveTextContent(
      "31/07/2022 · ingerido em",
    );

    await usuario.click(within(painel).getByRole("button", { name: "Fechar detalhes" }));
    expect(
      screen.queryByRole("complementary", { name: "Arborização do entorno do bairro" }),
    ).toBeNull();
  });

  it("bairro sem dado diz isso, sem 0%, e árvore sob o clique tem prioridade", async () => {
    const mapa = await abrirMapa("/mapa?arborizacao_entorno=1");
    await vi.waitFor(() => expect(pedidos).toHaveLength(1));
    mapa.renderizadas = [{ properties: { id: "a-1", quantidade: 1 } }];
    act(() =>
      mapa.emitir(
        "click",
        { point: { x: 5, y: 5 }, features: [{ properties: DADOS.features[1]!.properties }] },
        "arborizacao-entorno-sem-dado",
      ),
    );
    expect(
      screen.queryByRole("complementary", { name: "Arborização do entorno do bairro" }),
    ).toBeNull();

    mapa.renderizadas = [];
    act(() =>
      mapa.emitir(
        "click",
        { point: { x: 5, y: 5 }, features: [{ properties: DADOS.features[1]!.properties }] },
        "arborizacao-entorno-sem-dado",
      ),
    );
    const painel = await screen.findByRole("complementary", {
      name: "Arborização do entorno do bairro",
    });
    expect(within(painel).getByText(/Sem dado do Censo 2022 para este bairro/)).toBeInTheDocument();
    expect(within(painel).queryByText(/%/)).toBeNull();
  });
});

describe("áreas verdes (praças, parques e unidades de conservação)", () => {
  const camadasAreas = [
    "areas-verdes-preenchimento",
    "areas-verdes-contorno",
    "areas-verdes-contorno-uc",
  ];
  const visibilidades = (m: (typeof mapasCriados)[number], ligada: boolean) =>
    camadasAreas.every((id) =>
      m.setLayoutProperty.mock.calls.some(
        (c) => c[0] === id && c[2] === (ligada ? "visible" : "none"),
      ),
    );

  it("fica no grupo Territoriais, desligada por padrão e sem baixar nada", async () => {
    const mapa = await abrirMapa();
    const painel = screen.getByRole("complementary", { name: "Camadas e filtros" });
    const camada = within(painel).getByRole("checkbox", { name: "Áreas verdes" });
    expect(camada).not.toBeChecked();
    expect(camada.closest("details")).toHaveTextContent("Territoriais");
    // Camadas criadas, ocultas, abaixo das árvores.
    expect(mapa.camadas.map((c) => c.id)).toEqual(expect.arrayContaining(camadasAreas));
    const ordem = mapa.camadas.map((c) => c.id);
    expect(ordem.indexOf("areas-verdes-preenchimento")).toBeLessThan(
      ordem.indexOf("arvores-pontos"),
    );
    await vi.waitFor(() => expect(visibilidades(mapa, false)).toBe(true));
    expect(consultasAreasVerdes).toHaveLength(0);
    expect(screen.queryByText("Áreas verdes — tipo")).not.toBeInTheDocument();
  });

  it("ao ligar, carrega a camada uma vez e mostra a legenda com um item por tipo", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    await usuario.click(screen.getByRole("checkbox", { name: "Áreas verdes" }));

    await vi.waitFor(() => expect(mapa.dadosDe("areas-verdes").features).toHaveLength(2));
    expect(consultasAreasVerdes).toHaveLength(1);
    expect(consultasAreasVerdes[0]!.searchParams.get("precisao")).toBe("5");
    await vi.waitFor(() => expect(visibilidades(mapa, true)).toBe(true));

    const legenda = screen.getByRole("region", { name: "Legenda" });
    // Com o painel de camadas aberto, a legenda começa recolhida (C-09).
    const alternar = within(legenda).getByRole("button", { name: /Legenda/ });
    if (alternar.getAttribute("aria-expanded") === "false") await usuario.click(alternar);
    expect(within(legenda).getByText("Áreas verdes — tipo")).toBeInTheDocument();
    for (const tipo of ["Praça", "Parque urbano", "Unidade de conservação"])
      expect(within(legenda).getByText(tipo)).toBeInTheDocument();

    // Desligar e ligar de novo não baixa outra vez.
    await usuario.click(screen.getByRole("checkbox", { name: "Áreas verdes" }));
    await usuario.click(screen.getByRole("checkbox", { name: "Áreas verdes" }));
    expect(consultasAreasVerdes).toHaveLength(1);
  });

  it("mostra a fonte, a licença e as datas em Fontes dos dados", async () => {
    const usuario = userEvent.setup();
    await abrirMapa();
    await usuario.click(screen.getByRole("checkbox", { name: "Áreas verdes" }));
    expect(await screen.findByText(/Praça: Fortaleza em Mapas.*dados de 2019/)).toHaveTextContent(
      /uso livre, com citação obrigatória da fonte.*ingerido em/,
    );
  });

  it("avisa no painel de camadas quando a fonte das áreas verdes está desatualizada", async () => {
    situacaoFonteAreasVerdes = {
      ultima_importacao: "2026-08-01T04:00:00Z",
      dias: 71,
      limite_dias: 60,
      desatualizada: true,
    };
    const usuario = userEvent.setup();
    await abrirMapa();
    await usuario.click(screen.getByRole("checkbox", { name: "Áreas verdes" }));
    expect(
      await screen.findByText(/Fonte desatualizada: última importação há 71 dias/),
    ).toBeInTheDocument();
  });

  it("não avisa quando a fonte das áreas verdes está em dia", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    await usuario.click(screen.getByRole("checkbox", { name: "Áreas verdes" }));
    await vi.waitFor(() => expect(mapa.dadosDe("areas-verdes").features).toHaveLength(2));
    expect(screen.queryByText(/Fonte desatualizada/)).toBeNull();
  });

  it("o preenchimento não usa a cor Boa das árvores e tem uma cor por tipo", async () => {
    const { CORES_AREA_VERDE } = await import("../mapa/simbologia");
    const { CORES_CONDICAO } = await import("../mapa/simbologia");
    const cores = Object.values(CORES_AREA_VERDE);
    expect(new Set(cores).size).toBe(3);
    expect(cores).not.toContain(CORES_CONDICAO.boa);
    const mapa = await abrirMapa();
    const preenchimento = mapa.camadas.find((c) => c.id === "areas-verdes-preenchimento");
    expect(preenchimento?.type).toBe("fill");
    expect(JSON.stringify(preenchimento)).not.toContain(CORES_CONDICAO.boa);
  });

  it("clicar numa área mostra nome, tipo e fonte, e o painel pode ser fechado", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa("/mapa?areas_verdes=1");
    await vi.waitFor(() => expect(mapa.dadosDe("areas-verdes").features).toHaveLength(2));

    act(() =>
      mapa.emitir(
        "click",
        { point: { x: 1, y: 1 }, features: [{ properties: AREAS_VERDES.features[0]!.properties }] },
        "areas-verdes-preenchimento",
      ),
    );
    const painel = await screen.findByRole("complementary", { name: "Detalhes da área verde" });
    expect(within(painel).getByText("Largo do Mercado")).toBeInTheDocument();
    expect(within(painel).getByText("Praça")).toBeInTheDocument();
    expect(within(painel).getByText(/Fonte:/).parentElement).toHaveTextContent(/URBFOR/);
    expect(within(painel).getByText(/Dados de 2019/)).toBeInTheDocument();

    await usuario.click(within(painel).getByRole("button", { name: "Fechar detalhes" }));
    expect(screen.queryByRole("complementary", { name: "Detalhes da área verde" })).toBeNull();
  });

  it("árvore sob o clique tem prioridade sobre a área verde", async () => {
    const mapa = await abrirMapa("/mapa?areas_verdes=1");
    await vi.waitFor(() => expect(mapa.dadosDe("areas-verdes").features).toHaveLength(2));
    mapa.renderizadas = [{ properties: { id: "a-1", quantidade: 1 } }];

    act(() =>
      mapa.emitir(
        "click",
        { point: { x: 1, y: 1 }, features: [{ properties: AREAS_VERDES.features[0]!.properties }] },
        "areas-verdes-preenchimento",
      ),
    );
    expect(screen.queryByRole("complementary", { name: "Detalhes da área verde" })).toBeNull();
  });

  it("o painel da árvore informa em qual área verde ela está", async () => {
    servidor.use(
      http.get(`${API}/api/v1/arvores/a-1`, () =>
        HttpResponse.json({
          id: "a-1",
          codigo: "ARV-000001",
          especie: null,
          especie_estado: "informada",
          especie_texto_original: "Oiti",
          localizacao: { longitude: -38.54, latitude: -3.75 },
          localizacao_origem: "importada",
          precisao_m: null,
          endereco: "Rua 1",
          bairro: null,
          medidas_atuais: [],
          ocorrencias_abertas: 0,
          em_area_verde: { id: "av-1", nome: "Largo do Mercado", tipo: "praca" },
        }),
      ),
      http.get(`${API}/api/v1/evidencias`, () => HttpResponse.json([])),
    );
    await abrirMapa("/mapa?selecao=arvore:a-1");
    const painel = await screen.findByRole("complementary", { name: "Detalhes da seleção" });
    expect(await within(painel).findByText(/Em área verde:/)).toHaveTextContent(
      "Em área verde: Largo do Mercado",
    );
  });
});

describe("painel de camadas: grupo Filtros (R2-06)", () => {
  it("começa recolhido e sem contagem quando nenhum filtro está ativo", async () => {
    await abrirMapa();
    const grupo = (await screen.findByText("Filtros")).closest("details")!;
    expect(grupo).not.toHaveAttribute("open");
    expect(within(grupo).queryByText(/ativo/)).not.toBeInTheDocument();
  });

  it("mostra no título do grupo recolhido quantos filtros estão ativos", async () => {
    await abrirMapa("/mapa?condicao_aparente=ruim&sem_inspecao_dias=365");
    const grupo = (await screen.findByText("Filtros")).closest("details")!;
    expect(grupo).not.toHaveAttribute("open");
    expect(within(grupo).getByText("2 ativos")).toBeInTheDocument();
  });

  it("guarda os seletores de filtro no grupo, fora de Camadas e Árvores", async () => {
    await abrirMapa();
    const grupo = (await screen.findByText("Filtros")).closest("details")!;
    expect(within(grupo).getByLabelText("Condição aparente")).toBeInTheDocument();
    expect(within(grupo).getByLabelText("Identificação da espécie")).toBeInTheDocument();
  });
});

describe("agrupamentos legíveis no zoom afastado (R2-07)", () => {
  it("ocorrências ficam acima das árvores e nunca cedem lugar; grupos de árvores cedem", async () => {
    servidor.use(
      http.get(`${API}/api/v1/eu`, () =>
        HttpResponse.json({ ...GESTOR, permissoes: [...GESTOR.permissoes, "ocorrencias.ler"] }),
      ),
    );
    const mapa = await abrirMapa();
    await vi.waitFor(() => expect(mapa.getLayer("ocorrencias-grupos")).toBeDefined());
    const ordem = mapa.camadas.map((c) => c.id);
    for (const ocorrencia of ["ocorrencias-grupos", "ocorrencias-pontos"])
      for (const arvore of ["arvores-pontos", "arvores-grupos"])
        expect(ordem.indexOf(ocorrencia)).toBeGreaterThan(ordem.indexOf(arvore));
    expect(mapa.getLayer("arvores-grupos")?.layout?.["icon-allow-overlap"]).toBe(false);
    expect(mapa.getLayer("ocorrencias-grupos")?.layout?.["icon-allow-overlap"]).toBe(true);
    expect(mapa.getLayer("ocorrencias-pontos")?.layout?.["icon-allow-overlap"]).toBe(true);
  });
});
