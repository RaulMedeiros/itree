import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATRIBUICAO_ILHA_CALOR,
  CAMADA_ILHA_CALOR,
  FONTE_ILHA_CALOR,
  OPACIDADE_ILHA_CALOR,
  URL_LEGENDA_ILHA_CALOR,
  URL_TILES_ILHA_CALOR,
} from "../mapa/ilhaCalor";
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

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/mapa/camadas`, () =>
    HttpResponse.json({
      territorios: [],
      areas_verdes: [],
      iluminacao: null,
      arvores: { total: 0, sem_localizacao: 0, atualizado_em: null },
      ocorrencias: null,
      limites_escopo: null,
    }),
  ),
  http.get(`${API}/api/v1/territorios/geojson`, () =>
    HttpResponse.json({ type: "FeatureCollection", features: [] }),
  ),
  http.get(`${API}/api/v1/areas-verdes`, () =>
    HttpResponse.json({ type: "FeatureCollection", features: [] }),
  ),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
beforeEach(() => {
  mapasCriados.length = 0;
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

describe("camada Ilha de calor (UrbVerde)", () => {
  it("fica no grupo Contexto, desligada por padrão, com atribuição e sem mostrar legenda", async () => {
    const mapa = await abrirMapa();
    const grupo = (await screen.findByText("Contexto (fontes externas)")).closest("details")!;
    const caixa = within(grupo).getByRole("checkbox", { name: /Ilha de calor \(UrbVerde\)/ });
    expect(caixa).not.toBeChecked();
    expect(within(grupo).getByText(ATRIBUICAO_ILHA_CALOR, { exact: false })).toBeInTheDocument();

    // O raster WMS existe no mapa, mas oculto: o navegador não pede tile nenhum.
    const camada = mapa.getLayer(CAMADA_ILHA_CALOR);
    expect(camada?.type).toBe("raster");
    expect(camada?.layout?.visibility).toBe("none");
    expect(mapa.setLayoutProperty).not.toHaveBeenCalledWith(
      CAMADA_ILHA_CALOR,
      "visibility",
      "visible",
    );
    expect(screen.queryByTestId("legenda-ilha-calor")).toBeNull();
    expect(screen.queryByRole("slider", { name: "Opacidade da ilha de calor" })).toBeNull();
  });

  it("usa o WMS da UrbVerde em EPSG:3857, com a camada nacional de 2025 e a atribuição", async () => {
    const mapa = await abrirMapa();
    const fonte = mapa.fontes.get(FONTE_ILHA_CALOR) as { tiles?: string[] } | undefined;
    expect(fonte?.tiles).toEqual([URL_TILES_ILHA_CALOR]);
    const url = new URL(URL_TILES_ILHA_CALOR.replace("{bbox-epsg-3857}", "0,0,1,1"));
    expect(url.origin).toBe("https://urbverde.iau.usp.br");
    expect(url.pathname).toBe("/geoserver/urbverde/wms");
    expect(url.searchParams.get("layers")).toBe("urbverde:raster_temperatura_icus_nacional_2025");
    expect(url.searchParams.get("srs")).toBe("EPSG:3857");
    expect(url.searchParams.get("transparent")).toBe("true");
    // Abaixo de todos os dados: a camada é inserida antes das outras.
    expect(mapa.camadas.findIndex((c) => c.id === CAMADA_ILHA_CALOR)).toBe(
      mapa.camadas.findIndex((c) => c.id === "bairros-preenchimento") - 1,
    );
  });

  it("ao ligar, mostra o raster, a legenda oficial e a opacidade ajustável", async () => {
    const usuario = userEvent.setup();
    const mapa = await abrirMapa();
    await usuario.click(
      await screen.findByRole("checkbox", { name: /Ilha de calor \(UrbVerde\)/ }),
    );

    await vi.waitFor(() =>
      expect(mapa.setLayoutProperty).toHaveBeenCalledWith(
        CAMADA_ILHA_CALOR,
        "visibility",
        "visible",
      ),
    );
    const legenda = await screen.findByTestId("legenda-ilha-calor");
    expect(within(legenda).getByRole("img", { name: /Legenda da ilha de calor/ })).toHaveAttribute(
      "src",
      URL_LEGENDA_ILHA_CALOR,
    );
    expect(within(legenda).getByText(/Não é temperatura do ar/)).toBeVisible();
    expect(within(legenda).getByText(ATRIBUICAO_ILHA_CALOR, { exact: false })).toBeVisible();

    const controle = screen.getByRole("slider", { name: "Opacidade da ilha de calor" });
    expect(controle).toHaveValue(String(Math.round(OPACIDADE_ILHA_CALOR * 100)));
    fireEvent.change(controle, { target: { value: "40" } });
    await vi.waitFor(() =>
      expect(mapa.setPaintProperty).toHaveBeenCalledWith(CAMADA_ILHA_CALOR, "raster-opacity", 0.4),
    );

    await usuario.click(screen.getByRole("checkbox", { name: /Ilha de calor \(UrbVerde\)/ }));
    await vi.waitFor(() => {
      const visibilidades = mapa.setLayoutProperty.mock.calls
        .filter(([id]) => id === CAMADA_ILHA_CALOR)
        .map(([, , valor]) => valor);
      expect(visibilidades.at(-1)).toBe("none");
      expect(visibilidades).toContain("visible");
    });
    expect(screen.queryByTestId("legenda-ilha-calor")).toBeNull();
  });

  it("abre ligada quando o endereço pede (ficha do bairro e capturas)", async () => {
    const mapa = await abrirMapa("/mapa?ilha_calor=1&zoom=12");
    await vi.waitFor(() =>
      expect(mapa.setLayoutProperty).toHaveBeenCalledWith(
        CAMADA_ILHA_CALOR,
        "visibility",
        "visible",
      ),
    );
    expect(await screen.findByTestId("legenda-ilha-calor")).toBeVisible();
  });
});
