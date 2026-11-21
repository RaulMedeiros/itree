import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ControleTempo, PASSO_REPRODUCAO_MS } from "../mapa/ControleTempo";
import { mesAtual, rotuloDoMes, somarMeses, type SerieTemporal } from "../mapa/tempo";
import { simularCelular } from "./celular";
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
const AGORA = mesAtual();
const HA_6_MESES = somarMeses(AGORA, -6);

let permissoes: Eu["permissoes"] = ["mapa.ler", "inventario.ler", "alertas.ler"];
const euAtual = (): Eu => ({
  id: "u-g",
  nome: "Gil Gestor",
  email: "gil@itree.teste",
  papeis: ["gestor"],
  permissoes,
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
});

const SERIE: SerieTemporal = {
  primeiro_mes: HA_6_MESES,
  ultimo_mes: AGORA,
  meses: Array.from({ length: 7 }, (_, i) => ({
    mes: somarMeses(HA_6_MESES, i),
    arvores: i === 0 ? 400 : i * 10,
    ocorrencias: i,
    alertas: 0,
  })),
};

const consultas = { serie: 0, situacao: [] as URL[], alertas: [] as URL[] };

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(euAtual())),
  http.get(`${API}/api/v1/mapa/camadas`, () =>
    HttpResponse.json({
      territorios: [],
      areas_verdes: [],
      iluminacao: null,
      arvores: { total: 3, sem_localizacao: 0, atualizado_em: null },
      ocorrencias: null,
      limites_escopo: null,
    }),
  ),
  http.get(`${API}/api/v1/territorios/geojson`, () =>
    HttpResponse.json({ type: "FeatureCollection", features: [] }),
  ),
  http.get(`${API}/api/v1/mapa/serie-temporal`, () => {
    consultas.serie += 1;
    return HttpResponse.json(SERIE);
  }),
  http.get(`${API}/api/v1/mapa/situacao-na-data`, ({ request }) => {
    consultas.situacao.push(new URL(request.url));
    return HttpResponse.json({ arvores: 1234, ocorrencias_abertas: 7, alertas: 2 });
  }),
  http.get(`${API}/api/v1/mapa/alertas`, ({ request }) => {
    consultas.alertas.push(new URL(request.url));
    return HttpResponse.json({ type: "FeatureCollection", features: [] });
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
beforeEach(() => {
  mapasCriados.length = 0;
  permissoes = ["mapa.ler", "inventario.ler", "alertas.ler"];
  consultas.serie = 0;
  consultas.situacao.length = 0;
  consultas.alertas.length = 0;
});
afterEach(() => servidor.resetHandlers());
afterAll(() => servidor.close());

async function abrirMapa(rota = "/mapa") {
  const { criarRoteador } = await import("../rotas");
  const historico = createMemoryHistory({ initialEntries: [rota] });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={criarRoteador(historico)} />
    </QueryClientProvider>,
  );
  await screen.findByRole("region", { name: "Mapa de árvores e ocorrências" }, { timeout: 3000 });
  const mapa = await vi.waitFor(() => {
    expect(mapasCriados.length).toBeGreaterThan(0);
    return mapasCriados[0]!;
  });
  // O roteador grava texto que parece número entre aspas ("1"); aqui as aspas saem.
  const busca = () =>
    new Map(
      [...new URLSearchParams(historico.location.search)].map(([k, v]) => [
        k,
        v.replace(/^"(.*)"$/, "$1"),
      ]),
    );
  return { mapa, busca };
}

const tilesDe = (m: (typeof mapasCriados)[number], fonte: string) =>
  m.fontes.get(fonte)!.tiles![0]!;

describe("linha do tempo: liga e desliga", () => {
  it("começa desligada: o mapa mostra o presente e só o botão aparece", async () => {
    const { mapa, busca } = await abrirMapa();
    expect(await screen.findByRole("button", { name: "Linha do tempo" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Linha do tempo" })).toBeNull();
    expect(busca().has("ate")).toBe(false);
    expect(tilesDe(mapa, "arvores")).not.toContain("ate=");
    expect(consultas.serie).toBe(0);
  });

  it("liga pelo botão, põe `ate` na URL e mostra a situação no mês", async () => {
    const usuario = userEvent.setup();
    const { mapa, busca } = await abrirMapa();
    await usuario.click(await screen.findByRole("button", { name: "Linha do tempo" }));

    const controle = await screen.findByRole("region", { name: "Linha do tempo" });
    expect(busca().get("ate")).toBe(AGORA);
    expect(within(controle).getByText(`Situação em ${rotuloDoMes(AGORA)}`)).toBeInTheDocument();
    // O mês entra nos tiles de árvores.
    await vi.waitFor(() => expect(tilesDe(mapa, "arvores")).toContain(`ate=${AGORA}`));
    // Contagem do período, vinda do servidor com o mesmo mês.
    expect(await within(controle).findByText("1.234")).toBeInTheDocument();
    expect(within(controle).getByText(/Árvores na data/)).toBeInTheDocument();
    expect(consultas.situacao[0]!.searchParams.get("ate")).toBe(AGORA);
  });

  it("o passo para trás muda o mês na URL e nos tiles", async () => {
    const usuario = userEvent.setup();
    const { mapa, busca } = await abrirMapa(`/mapa?ate=${AGORA}`);
    await usuario.click(await screen.findByRole("button", { name: "Mês anterior" }));
    const anterior = somarMeses(AGORA, -1);
    await vi.waitFor(() => expect(busca().get("ate")).toBe(anterior));
    await vi.waitFor(() => expect(tilesDe(mapa, "arvores")).toContain(`ate=${anterior}`));
    expect(await screen.findByText(`Situação em ${rotuloDoMes(anterior)}`)).toBeInTheDocument();
  });

  it("o controle deslizante vai de um mês ao outro, do primeiro dado até hoje", async () => {
    const { busca } = await abrirMapa(`/mapa?ate=${AGORA}`);
    const controle = await screen.findByRole("slider", { name: "Mês da linha do tempo" });
    await vi.waitFor(() => expect(controle).toHaveAttribute("max", "6"));
    expect(controle).toHaveAttribute("aria-valuetext", rotuloDoMes(AGORA));
    fireEvent.change(controle, { target: { value: "0" } });
    await vi.waitFor(() => expect(busca().get("ate")).toBe(HA_6_MESES));
  });

  it("o modo intervalo põe `desde` na URL e muda o texto do período", async () => {
    const usuario = userEvent.setup();
    const { busca, mapa } = await abrirMapa(`/mapa?ate=${AGORA}`);
    await usuario.click(await screen.findByRole("button", { name: "Intervalo" }));
    await vi.waitFor(() => expect(busca().get("desde")).toBe(somarMeses(AGORA, -2)));
    expect(
      await screen.findByText(`De ${rotuloDoMes(somarMeses(AGORA, -2))} a ${rotuloDoMes(AGORA)}`),
    ).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(tilesDe(mapa, "arvores")).toContain(`desde=${somarMeses(AGORA, -2)}`),
    );
    expect(await screen.findByText(/Árvores cadastradas no período/)).toBeInTheDocument();
  });

  it("desligar tira `ate`, `desde` e `comparar` da URL e volta ao presente", async () => {
    const usuario = userEvent.setup();
    const { busca, mapa } = await abrirMapa(
      `/mapa?ate=${somarMeses(AGORA, -3)}&desde=${somarMeses(AGORA, -5)}&comparar=1`,
    );
    await usuario.click(await screen.findByRole("button", { name: "Desligar a linha do tempo" }));
    await vi.waitFor(() => {
      expect(busca().has("ate")).toBe(false);
      expect(busca().has("desde")).toBe(false);
      expect(busca().has("comparar")).toBe(false);
    });
    expect(tilesDe(mapa, "arvores")).not.toContain("ate=");
    expect(screen.getByRole("button", { name: "Linha do tempo" })).toBeInTheDocument();
  });

  it("alertas e focos pedem só o período escolhido", async () => {
    await abrirMapa(`/mapa?ate=${HA_6_MESES}&alertas=1`);
    await vi.waitFor(() => expect(consultas.alertas.length).toBeGreaterThan(0));
    expect(consultas.alertas.at(-1)!.searchParams.get("ate")).toBe(HA_6_MESES);
  });
});

// Com o painel de camadas aberto, a legenda começa recolhida.
async function abrirLegenda() {
  const legenda = await screen.findByRole("region", { name: "Legenda" });
  const botao = legenda.querySelector("button[aria-expanded]")!;
  if (botao.getAttribute("aria-expanded") === "false") await userEvent.click(botao);
}

describe("linha do tempo: legenda", () => {
  it("avisa que as camadas externas não têm linha do tempo", async () => {
    await abrirMapa(`/mapa?ate=${AGORA}&iluminacao=1`);
    await abrirLegenda();
    const legenda = await screen.findByTestId("legenda-iluminacao");
    expect(legenda).toHaveTextContent("camada sem linha do tempo");
  });

  it("sem a linha do tempo, nenhum aviso", async () => {
    await abrirMapa("/mapa?iluminacao=1");
    await abrirLegenda();
    const legenda = await screen.findByTestId("legenda-iluminacao");
    expect(legenda).not.toHaveTextContent("sem linha do tempo");
  });
});

describe("linha do tempo: comparar com hoje", () => {
  it("abre a cortina: a data escolhida de um lado e o presente do outro", async () => {
    const usuario = userEvent.setup();
    const { busca, mapa } = await abrirMapa(`/mapa?ate=${HA_6_MESES}`);
    expect(screen.queryByRole("slider", { name: /Posição da cortina/ })).toBeNull();
    await usuario.click(await screen.findByRole("button", { name: "Comparar com hoje" }));

    await vi.waitFor(() => expect(busca().get("comparar")).toBe("1"));
    await vi.waitFor(() => expect(mapasCriados).toHaveLength(2));
    const hoje = mapasCriados[1]!;
    // Lado esquerdo (mapa principal): o mês escolhido. Lado direito: o presente, sem `ate`.
    expect(tilesDe(mapa, "arvores")).toContain(`ate=${HA_6_MESES}`);
    expect(tilesDe(hoje, "arvores")).not.toContain("ate=");
    expect(
      screen.getByRole("region", { name: "Mapa de hoje, para comparação" }),
    ).toBeInTheDocument();
    const rotulos = screen.getAllByText(`Situação em ${rotuloDoMes(HA_6_MESES)}`);
    expect(rotulos.length).toBeGreaterThanOrEqual(2); // título do controle e chip da cortina
    expect(screen.getByText("Hoje")).toBeInTheDocument();
    // A câmera do mapa de hoje acompanha a do principal.
    mapa.emitir("move");
    expect(hoje.jumpTo).toHaveBeenCalled();
  });

  it("a alça da cortina se move pelo teclado", async () => {
    await abrirMapa(`/mapa?ate=${HA_6_MESES}&comparar=1`);
    const alca = await screen.findByRole("slider", { name: /Posição da cortina/ });
    expect(alca).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(alca, { key: "ArrowRight" });
    expect(alca).toHaveAttribute("aria-valuenow", "55");
    fireEvent.keyDown(alca, { key: "Home" });
    expect(alca).toHaveAttribute("aria-valuenow", "0");
  });

  it("sair da comparação fecha a cortina", async () => {
    const usuario = userEvent.setup();
    const { busca } = await abrirMapa(`/mapa?ate=${HA_6_MESES}&comparar=1`);
    await screen.findByRole("slider", { name: /Posição da cortina/ });
    await usuario.click(screen.getByRole("button", { name: "Comparar com hoje" }));
    await vi.waitFor(() => expect(busca().has("comparar")).toBe(false));
    expect(screen.queryByRole("slider", { name: /Posição da cortina/ })).toBeNull();
  });

  it("`comparar` sem `ate` não abre cortina: não há data para comparar", async () => {
    await abrirMapa("/mapa?comparar=1");
    await screen.findByRole("button", { name: "Linha do tempo" });
    expect(screen.queryByRole("slider", { name: /Posição da cortina/ })).toBeNull();
    expect(mapasCriados).toHaveLength(1);
  });
});

describe("linha do tempo no celular", () => {
  it("liga na coluna da base e some quando a folha de camadas abre", async () => {
    simularCelular();
    const usuario = userEvent.setup();
    const { busca } = await abrirMapa();
    await usuario.click(await screen.findByRole("button", { name: "Linha do tempo" }));
    await vi.waitFor(() => expect(busca().get("ate")).toBe(AGORA));
    expect(await screen.findByRole("region", { name: "Linha do tempo" })).toBeInTheDocument();
    // Compacto: sem o texto de apoio do desktop.
    expect(screen.queryByText(/não a do plantio/)).toBeNull();

    await usuario.click(screen.getByRole("button", { name: "Camadas e filtros" }));
    expect(screen.queryByRole("region", { name: "Linha do tempo" })).toBeNull();
  });
});

describe("ControleTempo: reproduzir", () => {
  function Banca({ inicial }: { inicial: string }) {
    const [ate, setAte] = useState(inicial);
    return (
      <>
        <output data-testid="mes">{ate}</output>
        <ControleTempo
          serie={SERIE}
          ate={ate}
          aoMudar={(p) => setAte(p.ate)}
          aoDesligar={() => undefined}
          comparando={false}
          aoComparar={() => undefined}
        />
      </>
    );
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("avança um mês a cada 0,8 s, pode pausar e para no fim", () => {
    expect(PASSO_REPRODUCAO_MS).toBe(800);
    const inicial = somarMeses(AGORA, -3);
    render(<Banca inicial={inicial} />);
    fireEvent.click(screen.getByRole("button", { name: "Reproduzir" }));
    expect(screen.getByRole("button", { name: "Pausar" })).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(799));
    expect(screen.getByTestId("mes")).toHaveTextContent(inicial);
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByTestId("mes")).toHaveTextContent(somarMeses(AGORA, -2));
    act(() => void vi.advanceTimersByTime(800));
    expect(screen.getByTestId("mes")).toHaveTextContent(somarMeses(AGORA, -1));

    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByTestId("mes")).toHaveTextContent(somarMeses(AGORA, -1));

    fireEvent.click(screen.getByRole("button", { name: "Reproduzir" }));
    act(() => void vi.advanceTimersByTime(800));
    expect(screen.getByTestId("mes")).toHaveTextContent(AGORA);
    // Chegou a hoje: para sozinho.
    expect(screen.getByRole("button", { name: "Reproduzir" })).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByTestId("mes")).toHaveTextContent(AGORA);
  });

  it("reproduzir no fim recomeça do primeiro mês", () => {
    render(<Banca inicial={AGORA} />);
    fireEvent.click(screen.getByRole("button", { name: "Reproduzir" }));
    expect(screen.getByTestId("mes")).toHaveTextContent(HA_6_MESES);
    act(() => void vi.advanceTimersByTime(800));
    expect(screen.getByTestId("mes")).toHaveTextContent(somarMeses(HA_6_MESES, 1));
  });

  it("mexer à mão no passo interrompe a reprodução", () => {
    render(<Banca inicial={somarMeses(AGORA, -4)} />);
    fireEvent.click(screen.getByRole("button", { name: "Reproduzir" }));
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    expect(screen.getByRole("button", { name: "Reproduzir" })).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.getByTestId("mes")).toHaveTextContent(somarMeses(AGORA, -3));
  });
});
