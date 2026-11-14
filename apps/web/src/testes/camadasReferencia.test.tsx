import { configurarCliente, type CamadaReferencia, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  idsDasCamadas,
  linhasDoPopup,
  rotuloDaPropriedade,
  textoDoValor,
} from "../mapa/camadasReferencia";
import { mapasCriados } from "./mapaFalso";
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

const popups: { conteudo?: HTMLElement; ponto?: unknown }[] = [];
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: () => undefined,
  Marker: vi.fn(),
  Popup: class {
    registro: { conteudo?: HTMLElement; ponto?: unknown } = {};
    constructor() {
      popups.push(this.registro);
    }
    setLngLat(p: unknown) {
      this.registro.ponto = p;
      return this;
    }
    setDOMContent(c: HTMLElement) {
      this.registro.conteudo = c;
      return this;
    }
    addTo() {
      return this;
    }
  },
}));
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

const CAMADA: CamadaReferencia = {
  id: "c-1",
  nome: "Atendimentos do Plano de Arborização",
  cor: "#7a4fb5",
  orgao: "Prefeitura de Fortaleza, SEUMA",
  licenca: "Não declarada pela fonte",
  url_origem: "https://mapas.fortaleza.ce.gov.br/",
  rotulos: { name: "Endereço", description: "Atendimento", ano_ref: "Ano de referência" },
  total: 577,
  atualizada_em: "2026-11-14T12:00:00Z",
};

const FEICOES = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "1",
      geometry: { type: "Point", coordinates: [-38.5593311, -3.8281907] },
      properties: {
        id: 1,
        fid: 1,
        name: "Av. João de Araújo Lima, 731",
        description: 'Doação de 02 mudas.<br>02 mudas de <script>alert("x")</script>Flamboyant.',
        ano_ref: 2021,
        epsg_codif: "EPSG: 31984",
      },
    },
  ],
};

let camadas: CamadaReferencia[] = [CAMADA];
const buscas: string[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/mapa/camadas`, () =>
    HttpResponse.json({
      territorios: [],
      areas_verdes: [],
      arvores: { total: 0, sem_localizacao: 0, atualizado_em: null },
      ocorrencias: null,
      limites_escopo: null,
    }),
  ),
  http.get(`${API}/api/v1/territorios/geojson`, () =>
    HttpResponse.json({ type: "FeatureCollection", features: [] }),
  ),
  http.get(`${API}/api/v1/mapa/camadas-referencia`, () => HttpResponse.json(camadas)),
  http.get(`${API}/api/v1/mapa/camadas-referencia/:id`, ({ params }) => {
    buscas.push(String(params.id));
    return HttpResponse.json(FEICOES);
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
beforeEach(() => {
  mapasCriados.length = 0;
  popups.length = 0;
  buscas.length = 0;
  camadas = [CAMADA];
});
afterEach(() => servidor.resetHandlers());
afterAll(() => servidor.close());

async function abrirMapa() {
  const { criarRoteador } = await import("../rotas");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={criarRoteador(createMemoryHistory({ initialEntries: ["/mapa"] }))} />
    </QueryClientProvider>,
  );
  await screen.findByRole("region", { name: "Mapa de árvores e ocorrências" }, { timeout: 3000 });
  return waitFor(() => {
    expect(mapasCriados).toHaveLength(1);
    return mapasCriados[0]!;
  });
}

describe("camadas de referência no painel do mapa", () => {
  it("aparece como camada opcional, desligada, sem buscar as feições", async () => {
    const mapa = await abrirMapa();
    const caixa = await screen.findByRole("checkbox", {
      name: /Atendimentos do Plano de Arborização/,
    });
    expect(caixa).not.toBeChecked();
    expect(screen.getByText("Camadas conectadas")).toBeInTheDocument();
    expect(buscas).toEqual([]);
    expect(mapa.getLayer("ref-c-1-ponto")).toBeUndefined();
    expect(screen.queryByText(/Legenda: Atendimentos/)).toBeNull();
  });

  it("ao ligar, busca as feições, desenha a camada e mostra legenda e atribuição", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    await usuario.click(
      await screen.findByRole("checkbox", { name: /Atendimentos do Plano de Arborização/ }),
    );
    await waitFor(() => expect(buscas).toEqual(["c-1"]));
    await waitFor(() => expect(mapa.dadosDe("ref-c-1").features).toHaveLength(1));
    for (const id of idsDasCamadas("c-1")) expect(mapa.getLayer(id)).toBeDefined();
    expect(mapa.camadaDe("ref-c-1-ponto")?.paint?.["circle-color"]).toBe("#7a4fb5");
    expect(screen.getByText(/Legenda: Atendimentos do Plano/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Prefeitura de Fortaleza, SEUMA" })).toHaveAttribute(
      "href",
      "https://mapas.fortaleza.ce.gov.br/",
    );
    expect(screen.getByText(/Não declarada pela fonte/)).toBeInTheDocument();
    expect(screen.getByText(/atualizada em 14\/11\/2026/)).toBeInTheDocument();
  });

  it("desligar esconde a camada sem buscar de novo", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    const caixa = await screen.findByRole("checkbox", {
      name: /Atendimentos do Plano de Arborização/,
    });
    await usuario.click(caixa);
    await waitFor(() => expect(mapa.getLayer("ref-c-1-ponto")).toBeDefined());
    await usuario.click(caixa);
    await waitFor(() =>
      expect(mapa.setLayoutProperty).toHaveBeenCalledWith("ref-c-1-ponto", "visibility", "none"),
    );
    await usuario.click(caixa);
    await waitFor(() =>
      expect(mapa.setLayoutProperty).toHaveBeenLastCalledWith(
        "ref-c-1-ponto",
        "visibility",
        "visible",
      ),
    );
    expect(buscas).toEqual(["c-1"]);
  });

  it("a camada fica abaixo das árvores e das ocorrências", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    await usuario.click(
      await screen.findByRole("checkbox", { name: /Atendimentos do Plano de Arborização/ }),
    );
    await waitFor(() => expect(mapa.getLayer("ref-c-1-ponto")).toBeDefined());
    const antes = mapa.getLayer("ref-c-1-ponto")?.antesDe;
    expect([
      "arvores-grupos",
      "arvores-pontos",
      "ocorrencias-grupos",
      "ocorrencias-pontos",
    ]).toContain(antes);
  });

  it("o popup mostra as propriedades com rótulos legíveis, como texto", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    await usuario.click(
      await screen.findByRole("checkbox", { name: /Atendimentos do Plano de Arborização/ }),
    );
    await waitFor(() => expect(mapa.getLayer("ref-c-1-ponto")).toBeDefined());
    mapa.emitir(
      "click",
      {
        point: { x: 1, y: 1 },
        lngLat: { lng: -38.55, lat: -3.82 },
        features: [{ properties: FEICOES.features[0]!.properties }],
      },
      "ref-c-1-ponto",
    );
    expect(popups).toHaveLength(1);
    const conteudo = within(popups[0]!.conteudo!);
    expect(conteudo.getByText("Atendimentos do Plano de Arborização")).toBeTruthy();
    expect(conteudo.getByText("Endereço")).toBeTruthy();
    expect(conteudo.getByText("Av. João de Araújo Lima, 731")).toBeTruthy();
    expect(conteudo.getByText("Ano de referência")).toBeTruthy();
    expect(conteudo.getByText("2021")).toBeTruthy();
    // Sem rótulo, a propriedade não aparece (fid, epsg_codif) e nada vira marcação.
    expect(conteudo.queryByText("Fid")).toBeNull();
    expect(popups[0]!.conteudo!.querySelector("script")).toBeNull();
    expect(popups[0]!.conteudo!.textContent).toContain("02 mudas de alert");
    expect(conteudo.getByText("Fonte: Prefeitura de Fortaleza, SEUMA")).toBeTruthy();
  });

  it("clicar numa árvore sob o ponto não abre o popup da camada", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    await usuario.click(
      await screen.findByRole("checkbox", { name: /Atendimentos do Plano de Arborização/ }),
    );
    await waitFor(() => expect(mapa.getLayer("ref-c-1-ponto")).toBeDefined());
    mapa.renderizadas = [{ properties: {} }];
    mapa.emitir(
      "click",
      { point: { x: 1, y: 1 }, lngLat: { lng: 0, lat: 0 }, features: [{ properties: {} }] },
      "ref-c-1-ponto",
    );
    expect(popups).toHaveLength(0);
  });

  it("sem camadas ativas o painel não mostra o grupo", async () => {
    camadas = [];
    await abrirMapa();
    await screen.findByRole("checkbox", { name: /Bairros/ });
    expect(screen.queryByText("Camadas conectadas")).toBeNull();
  });
});

describe("texto do popup", () => {
  it("rótulo legível a partir do nome da propriedade", () => {
    expect(rotuloDaPropriedade("ano_ref")).toBe("Ano ref");
    expect(rotuloDaPropriedade("nome-popular")).toBe("Nome popular");
  });

  it("valores viram texto puro: quebra de linha no lugar de <br> e sem marcação", () => {
    expect(textoDoValor("a<br>b<br/>c")).toBe("a\nb\nc");
    expect(textoDoValor('<img src=x onerror="alert(1)">oi')).toBe("oi");
    expect(textoDoValor(null)).toBe("");
    expect(textoDoValor({ a: 1 })).toBe('{"a":1}');
    expect(textoDoValor("x".repeat(500))).toHaveLength(401);
  });

  it("com rótulos só as propriedades listadas; sem rótulos, todas", () => {
    const props = { a: "1", b: "2", c: "", d: null };
    expect(linhasDoPopup(props, { b: "Segundo", a: "Primeiro" })).toEqual([
      { rotulo: "Segundo", valor: "2" },
      { rotulo: "Primeiro", valor: "1" },
    ]);
    expect(linhasDoPopup(props, {})).toEqual([
      { rotulo: "A", valor: "1" },
      { rotulo: "B", valor: "2" },
    ]);
  });
});
