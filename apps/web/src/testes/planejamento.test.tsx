import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { respostaDeTeste } from "./planejamentoDados";
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

const quadrado = (x: number) => ({
  type: "Polygon",
  coordinates: [
    [
      [x, 0],
      [x + 1, 0],
      [x + 1, 1],
      [x, 1],
      [x, 0],
    ],
  ],
});
const GEOMETRIAS = {
  type: "FeatureCollection",
  features: ["b-pobre", "b-denso", "b-quente", "b-sem-renda", "b-fora"].map((id, i) => ({
    type: "Feature",
    id,
    geometry: quadrado(i),
    properties: { nome: id },
  })),
};

let comCalor = false;
let eu: Eu = GESTOR;
const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/planejamento/criterios`, () =>
    HttpResponse.json(respostaDeTeste(comCalor)),
  ),
  http.get(`${API}/api/v1/territorios/geojson`, () => HttpResponse.json(GEOMETRIAS)),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
beforeEach(() => {
  comCalor = false;
  eu = GESTOR;
  mapasCriados.length = 0;
});
afterEach(() => servidor.resetHandlers());
afterAll(() => servidor.close());

async function abrir(caminho = "/planejamento") {
  const { criarRoteador } = await import("../rotas");
  const historia = createMemoryHistory({ initialEntries: [caminho] });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={criarRoteador(historia)} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Onde plantar" });
  await screen.findByRole("region", { name: "Ranking dos bairros" });
  return historia;
}

/** Nomes do ranking, na ordem em que aparecem. */
const ranking = () => {
  const lista = within(screen.getByRole("region", { name: "Ranking dos bairros" })).getByRole(
    "list",
    { name: "", hidden: false },
  );
  return within(lista)
    .getAllByRole("button")
    .map((b) => b.querySelector("span.font-medium")?.textContent);
};

const lerBlob = (b: Blob) =>
  new Promise<string>((resolve) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.readAsText(b);
  });

const mudarPeso = (nome: RegExp | string, valor: number) =>
  fireEvent.change(screen.getByRole("slider", { name: nome }), {
    target: { value: String(valor) },
  });

describe("página Onde plantar", () => {
  it("avisa que é cenário, não índice oficial, e lista as fontes com o ano", async () => {
    await abrir();
    expect(screen.getByText("Cenário de priorização — não é índice oficial (DP-14)")).toBeVisible();
    const fontes = screen.getByRole("region", { name: "Fontes dos critérios" });
    expect(within(fontes).getByText(/IBGE, Censo Demográfico 2022 \(renda\), 2022/)).toBeVisible();
    expect(within(fontes).getByText(/Fortaleza em Mapas \(Ipplan\), 2019/)).toBeVisible();
    expect(within(fontes).getByText(/IDH 2010 não entra como critério/)).toBeVisible();
  });

  it("os pesos mudam a ordem do ranking", async () => {
    await abrir("/planejamento?renda=5&densidade=0&arborizacao=0&arvores=0&verde=0");
    await vi.waitFor(() => expect(ranking()[0]).toBe("Pobre"));
    mudarPeso(/Baixo rendimento/, 0);
    mudarPeso(/Alta densidade/, 5);
    await vi.waitFor(() => expect(ranking()[0]).toBe("Denso"));
  });

  it("os cenários prontos ajustam os pesos e o ranking", async () => {
    const usuario = userEvent.setup();
    await abrir();
    const equilibrado = screen.getByRole("button", { name: "Equilibrado" });
    expect(equilibrado).toHaveAttribute("aria-pressed", "true");

    await usuario.click(screen.getByRole("button", { name: "Equidade" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Equidade" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByRole("slider", { name: /Baixo rendimento/ })).toHaveValue("5");
    expect(ranking()[0]).toBe("Pobre");

    // Sem ilha de calor, "Calor e densidade" cai para densidade e arborização.
    await usuario.click(screen.getByRole("button", { name: "Calor e densidade" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("slider", { name: /Alta densidade/ })).toHaveValue("5"),
    );
    expect(screen.getByRole("slider", { name: /Pouca arborização/ })).toHaveValue("5");
    expect(screen.getByRole("slider", { name: /Ilha de calor/ })).toHaveValue("0");
  });

  it("com os dados de calor, Calor e densidade dá peso à ilha de calor", async () => {
    comCalor = true;
    const usuario = userEvent.setup();
    await abrir();
    expect(screen.getByRole("slider", { name: /Ilha de calor/ })).toBeEnabled();
    await usuario.click(screen.getByRole("button", { name: "Calor e densidade" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("slider", { name: /Ilha de calor/ })).toHaveValue("5"),
    );
    expect(screen.getByRole("slider", { name: /Pouca arborização/ })).toHaveValue("2");
  });

  it("sem os valores da ilha de calor, o critério fica desabilitado, com a explicação", async () => {
    await abrir();
    const controle = screen.getByRole("slider", { name: /Ilha de calor/ });
    expect(controle).toBeDisabled();
    expect(
      screen.getAllByText("Aguardando autorização de uso dos dados do UrbVerde.").length,
    ).toBeGreaterThan(0);
  });

  it("os pesos ficam na URL e a URL do cenário padrão fica limpa", async () => {
    const historia = await abrir();
    expect(historia.location.search).toBe("");
    mudarPeso(/Baixo rendimento/, 5);
    await vi.waitFor(() => expect(historia.location.search).toContain("renda=5"));
    expect(historia.location.search).not.toContain("densidade");
    // Voltar ao cenário Equilibrado limpa a URL de novo.
    await userEvent.click(screen.getByRole("button", { name: "Equilibrado" }));
    await vi.waitFor(() => expect(historia.location.search).toBe(""));
  });

  it("lê os pesos da URL", async () => {
    await abrir("/planejamento?renda=5&densidade=1");
    expect(screen.getByRole("slider", { name: /Baixo rendimento/ })).toHaveValue("5");
    expect(screen.getByRole("slider", { name: /Alta densidade/ })).toHaveValue("1");
    expect(screen.getByRole("slider", { name: /Pouca arborização/ })).toHaveValue("3");
  });

  it("marca no ranking o bairro sem dado num critério ativo", async () => {
    await abrir("/planejamento?renda=5&densidade=5&arborizacao=0&arvores=0&verde=0");
    const linha = screen.getByRole("button", { name: /Sem renda/ });
    expect(within(linha).getByText(/Sem dado: Renda/)).toBeVisible();
    expect(
      within(screen.getByRole("button", { name: /Pobre/ })).queryByText(/Sem dado/),
    ).toBeNull();
  });

  it("o mapa recebe a classe de cada bairro, só dos bairros do escopo, e hachura quem não tem pontuação", async () => {
    await abrir("/planejamento?renda=5&densidade=0&arborizacao=0&arvores=0&verde=0");
    const mapa = await vi.waitFor(() => {
      expect(mapasCriados).toHaveLength(1);
      return mapasCriados[0]!;
    });
    await vi.waitFor(() => expect(mapa.dadosDe("prioridade")?.features?.length).toBe(4));
    const classes = Object.fromEntries(
      mapa.dadosDe("prioridade").features.map((f) => [f.properties.id, f.properties.classe]),
    );
    expect(classes["b-fora"]).toBeUndefined();
    expect(classes["b-pobre"]).toBe(4);
    // O bairro sem renda não tem critério ativo com dado: sem classe, hachurado.
    expect(classes["b-sem-renda"]).toBeNull();
    expect(mapa.camadaDe("prioridade-sem-dado")).toBeDefined();
  });

  it("clicar no bairro no ranking abre o painel com os valores brutos, a fonte e o link da ficha", async () => {
    const usuario = userEvent.setup();
    const historia = await abrir();
    await usuario.click(screen.getByRole("button", { name: /^\d*\s*Pobre/ }));
    const painel = await screen.findByRole("region", { name: "Critérios de Pobre" });
    expect(within(painel).getByText("R$ 900")).toBeVisible();
    expect(within(painel).getByText("31,5%")).toBeVisible();
    expect(within(painel).getByText("2.000 hab/km²")).toBeVisible();
    expect(within(painel).getByText(/IBGE, Censo Demográfico 2022 \(renda\), 2022/)).toBeVisible();
    expect(
      within(painel).getByText("Aguardando autorização de uso dos dados do UrbVerde."),
    ).toBeVisible();
    expect(within(painel).getByRole("link", { name: /Abrir a ficha do bairro/ })).toHaveAttribute(
      "href",
      "/bairros/b-pobre",
    );
    expect(historia.location.search).toContain("bairro=b-pobre");
    await usuario.click(within(painel).getByRole("button", { name: "Fechar o painel" }));
    await vi.waitFor(() =>
      expect(screen.queryByRole("region", { name: "Critérios de Pobre" })).toBeNull(),
    );
  });

  it("clicar no bairro no mapa abre o painel, e o bairro sem dado mostra 'Sem dado'", async () => {
    await abrir();
    const mapa = await vi.waitFor(() => {
      expect(mapasCriados).toHaveLength(1);
      return mapasCriados[0]!;
    });
    mapa.emitir(
      "click",
      { features: [{ properties: { id: "b-sem-renda" } }] },
      "prioridade-preenchimento",
    );
    const painel = await screen.findByRole("region", { name: "Critérios de Sem renda" });
    expect(within(painel).getAllByText("Sem dado").length).toBeGreaterThan(0);
    await vi.waitFor(() =>
      expect(mapa.setFilter).toHaveBeenLastCalledWith("prioridade-selecao", [
        "==",
        ["get", "id"],
        "b-sem-renda",
      ]),
    );
  });

  it("abre o painel do bairro que vem na URL", async () => {
    await abrir("/planejamento?bairro=b-denso");
    expect(await screen.findByRole("region", { name: "Critérios de Denso" })).toBeVisible();
  });

  it("Copiar link do cenário copia o endereço com os pesos", async () => {
    const usuario = userEvent.setup();
    await abrir("/planejamento?renda=5");
    const copiar = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: copiar },
      configurable: true,
    });
    await usuario.click(screen.getByRole("button", { name: /Copiar link do cenário/ }));
    await vi.waitFor(() => expect(copiar).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText("Link do cenário copiado.").length).toBeGreaterThan(0);
  });

  it("Exportar CSV baixa o ranking com os pesos e as fontes", async () => {
    const usuario = userEvent.setup();
    let blob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return "blob:x";
    });
    URL.revokeObjectURL = vi.fn();
    await abrir("/planejamento?renda=5");
    await usuario.click(screen.getByRole("button", { name: "Exportar CSV" }));
    expect(blob).not.toBeNull();
    const texto = await lerBlob(blob!);
    expect(texto).toContain("não é índice oficial (DP-14)");
    expect(texto).toContain("Renda 5");
    expect(texto).toContain("IBGE, Censo Demográfico 2022 (renda), 2022");
    expect(texto).toMatch(/\r\n1;Pobre;/);
  });
});

describe("navegação para o planejamento", () => {
  it("o menu tem Onde plantar para quem lê relatórios, e não para quem não lê", async () => {
    await abrir();
    expect(screen.getByRole("link", { name: /Onde plantar/ })).toHaveAttribute(
      "href",
      "/planejamento",
    );
  });

  it("sem a permissão de relatórios a página nega o acesso", async () => {
    eu = { ...GESTOR, permissoes: ["mapa.ler"] };
    const { criarRoteador } = await import("../rotas");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider
          router={criarRoteador(createMemoryHistory({ initialEntries: ["/planejamento"] }))}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/não tem permissão|Sem permissão/i)).toBeVisible();
    expect(screen.queryByRole("link", { name: /Onde plantar/ })).toBeNull();
  });
});
