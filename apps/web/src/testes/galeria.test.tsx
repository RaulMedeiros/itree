import { configurarCliente, type Eu, type FotoArvore } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ComparadorFotos } from "../componentes/ComparadorFotos";
import { GraficoCondicao } from "../componentes/LinhaDoTempoVisual";
import { degraus, nivelDaCondicao, posicaoNaEscala } from "../componentes/linhaDoTempoVisual";
import { CORES_CONDICAO } from "../mapa/simbologia";
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
vi.mock("maplibre-gl", () => ({ setWorkerUrl: () => undefined }));
vi.mock("../mapa/Mapa", async () => ({
  Mapa: (await import("./MapaFalsoComponente")).MapaFalsoComponente,
}));

const API = "http://api.teste";

const EU: Eu = {
  id: "u-1",
  nome: "Rita",
  email: "rita@itree.teste",
  papeis: ["tecnico"],
  permissoes: ["mapa.ler", "inventario.ler", "inventario.editar", "inspecoes.ler"],
  territorios: [{ id: "t-for", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const foto = (parcial: Partial<FotoArvore>): FotoArvore => ({
  id: "f-1",
  url: "http://armazenamento.teste/original-1.jpg",
  url_miniatura: "http://armazenamento.teste/mini-1.jpg",
  descricao: "",
  nome_original: "f.jpg",
  data: "2026-03-01T12:00:00Z",
  origem: "evidencia",
  origem_id: null,
  origem_codigo: "ARV-000001",
  autor: "Tiago Técnico",
  ilustrativa: false,
  ...parcial,
});

const FOTOS: FotoArvore[] = [
  foto({ id: "f-1", descricao: "Tronco antes da poda", data: "2026-03-01T12:00:00Z" }),
  foto({
    id: "f-2",
    url: "http://armazenamento.teste/original-2.jpg",
    url_miniatura: "http://armazenamento.teste/mini-2.jpg",
    descricao: "Galho sobre a fiação",
    data: "2026-05-10T12:00:00Z",
    origem: "inspecao",
    origem_id: "i-1",
    origem_codigo: "INS-000007",
    autor: "Bia Técnica",
  }),
  foto({
    id: "f-3",
    url: "http://armazenamento.teste/original-3.jpg",
    url_miniatura: null,
    descricao: "Depois da poda",
    data: "2026-08-20T12:00:00Z",
    origem: "ocorrencia",
    origem_id: "o-1",
    origem_codigo: "OCO-000003",
    autor: "Marta",
  }),
];

let fotos: FotoArvore[] = FOTOS;
let permissoes = EU.permissoes;

const LINHA = {
  eventos: [
    {
      id: "cadastro-a-1",
      tipo: "cadastro",
      data: "2026-01-10T12:00:00Z",
      titulo: "Cadastro da árvore",
      resumo: "ARV-000001 cadastrada.",
      condicao: "",
      origem_id: null,
    },
    {
      id: "medicao-1",
      tipo: "medicao",
      data: "2026-02-01T12:00:00Z",
      titulo: "Medição",
      resumo: "Altura total 8 m",
      condicao: "",
      origem_id: null,
    },
    {
      id: "inspecao-i-1",
      tipo: "inspecao",
      data: "2026-05-10T12:00:00Z",
      titulo: "Inspeção INS-000007",
      resumo: "Condição aparente: Ruim.",
      condicao: "ruim",
      origem_id: "i-1",
    },
    {
      id: "tarefa-t-1",
      tipo: "poda",
      data: "2026-08-21T12:00:00Z",
      titulo: "Poda concluída TAR-000002",
      resumo: "Poda feita",
      condicao: "",
      origem_id: "t-1",
    },
  ],
  condicao: [
    { data: "2026-02-01T12:00:00Z", condicao: "boa", inspecao_codigo: "INS-000001" },
    { data: "2026-05-10T12:00:00Z", condicao: "ruim", inspecao_codigo: "INS-000007" },
  ],
  medidas: [
    {
      tipo: "altura",
      unidade: "m",
      pontos: [
        { data: "2026-02-01", valor: 8, unidade: "m", origem: "medido" },
        { data: "2026-09-01", valor: 9.5, unidade: "m", origem: "estimado" },
      ],
    },
    {
      tipo: "dap",
      unidade: "cm",
      pontos: [{ data: "2026-02-01", valor: 30, unidade: "cm", origem: "medido" }],
    },
  ],
};

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json({ ...EU, permissoes })),
  http.get(`${API}/api/v1/arvores/a-1`, () =>
    HttpResponse.json({
      id: "a-1",
      codigo: "ARV-000001",
      especie: null,
      especie_estado: "informada",
      especie_texto_original: "Oiti",
      localizacao: { longitude: -38.54, latitude: -3.74 },
      localizacao_origem: "importada",
      precisao_m: null,
      endereco: "Rua 1",
      bairro: null,
      situacao: "ativa",
      valida: true,
      origem_registro: "importacao",
      ocorrencias_abertas: 0,
      condicao_aparente: "ruim",
      criado_em: "2026-01-10T12:00:00Z",
      atualizado_em: "2026-01-10T12:00:00Z",
      identificadores: [],
      medidas_atuais: [],
      observacoes: "",
      criado_por_nome: "Rita",
      motivo_situacao: "",
      em_area_verde: null,
      especie_cartao: {
        id: "s-1",
        nome_cientifico: "Licania tomentosa",
        nomes_comuns: ["oiti"],
        familia: "Chrysobalanaceae",
        nativa_brasil: true,
        imagem_url: "http://commons.teste/oiti.jpg",
        imagem_autor: "Maria Fotógrafa",
        imagem_licenca: "CC BY-SA 4.0",
        imagem_fonte: "Wikimedia Commons",
      },
    }),
  ),
  http.get(`${API}/api/v1/arvores/a-1/fotos`, () => HttpResponse.json(fotos)),
  http.get(`${API}/api/v1/arvores/a-1/linha-do-tempo`, () => HttpResponse.json(LINHA)),
  http.get(`${API}/api/v1/evidencias`, () => HttpResponse.json([])),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  fotos = FOTOS;
  permissoes = EU.permissoes;
});
afterAll(() => servidor.close());

async function abrirGaleria() {
  const usuario = userEvent.setup();
  const { criarRoteador } = await import("../rotas");
  const roteador = criarRoteador(
    createMemoryHistory({ initialEntries: ["/inventario/arvores/a-1"] }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={roteador} />
    </QueryClientProvider>,
  );
  await usuario.click(await screen.findByRole("tab", { name: "Galeria" }));
  return usuario;
}

describe("ficha da árvore no celular", () => {
  it("as abas rolam na horizontal e não quebram o rótulo", async () => {
    await abrirGaleria();
    const abas = screen.getByRole("tablist", { name: "Seções da árvore" });
    expect(abas).toHaveClass("overflow-x-auto");
    for (const aba of within(abas).getAllByRole("tab"))
      expect(aba).toHaveClass("shrink-0", "whitespace-nowrap", "max-md:min-h-11");
  });

  it("a galeria mostra 2 colunas no celular", async () => {
    await abrirGaleria();
    const grade = (await screen.findAllByRole("button", { name: /^Abrir foto/ }))[0]!.closest(
      "ul",
    )!;
    expect(grade).toHaveClass("grid-cols-2");
  });
});

describe("galeria da árvore", () => {
  it("mostra o mosaico com miniaturas (não o original) em ordem cronológica", async () => {
    await abrirGaleria();
    const botoes = await screen.findAllByRole("button", { name: /^Abrir foto/ });
    expect(botoes).toHaveLength(3);
    expect(botoes[0]).toHaveAccessibleName(/01\/03\/2026.*Evidência da árvore ARV-000001/);
    expect(botoes[1]).toHaveAccessibleName(/Inspeção INS-000007/);
    const imagens = botoes.map((b) => within(b).getByRole("img"));
    expect(imagens[0]).toHaveAttribute("src", "http://armazenamento.teste/mini-1.jpg");
    expect(imagens[1]).toHaveAttribute("src", "http://armazenamento.teste/mini-2.jpg");
    // Sem miniatura no backend, a grade cai no original.
    expect(imagens[2]).toHaveAttribute("src", "http://armazenamento.teste/original-3.jpg");
    expect(imagens[1]).toHaveAttribute("alt", expect.stringContaining("Galho sobre a fiação"));
  });

  it("abre em tela cheia com o original, a data, a origem, o autor e a legenda", async () => {
    const usuario = await abrirGaleria();
    await usuario.click(
      await screen.findByRole("button", { name: /Abrir foto.*Inspeção INS-000007/ }),
    );
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByRole("img")).toHaveAttribute(
      "src",
      "http://armazenamento.teste/original-2.jpg",
    );
    expect(within(dialogo).getByText(/Foto 2 de 3/)).toBeInTheDocument();
    expect(within(dialogo).getByRole("link", { name: "Inspeção INS-000007" })).toHaveAttribute(
      "href",
      "/inspecoes/i-1",
    );
    expect(within(dialogo).getByText("Bia Técnica")).toBeInTheDocument();
    expect(within(dialogo).getAllByText("Galho sobre a fiação").length).toBeGreaterThan(0);
  });

  it("navega com ← e → até os limites e fecha com Esc", async () => {
    const usuario = await abrirGaleria();
    await usuario.click(await screen.findByRole("button", { name: /Abrir foto.*01\/03\/2026/ }));
    const dialogo = await screen.findByRole("dialog");
    const imagem = () => within(dialogo).getByRole("img");
    expect(within(dialogo).getByRole("button", { name: "Foto anterior" })).toBeDisabled();

    await usuario.keyboard("{ArrowRight}");
    expect(imagem()).toHaveAttribute("src", "http://armazenamento.teste/original-2.jpg");
    await usuario.keyboard("{ArrowRight}{ArrowRight}");
    expect(imagem()).toHaveAttribute("src", "http://armazenamento.teste/original-3.jpg");
    expect(within(dialogo).getByRole("button", { name: "Próxima foto" })).toBeDisabled();
    await usuario.keyboard("{ArrowLeft}");
    expect(imagem()).toHaveAttribute("src", "http://armazenamento.teste/original-2.jpg");

    await usuario.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("prende o foco no visualizador", async () => {
    const usuario = await abrirGaleria();
    await usuario.click(await screen.findByRole("button", { name: /Abrir foto.*01\/03\/2026/ }));
    const dialogo = await screen.findByRole("dialog");
    for (let i = 0; i < 6; i++) {
      await usuario.tab();
      expect(dialogo).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("mostra a imagem de referência da espécie com o aviso e a atribuição", async () => {
    await abrirGaleria();
    const referencia = await screen.findByRole("complementary", { name: "Referência da espécie" });
    expect(
      within(referencia).getByText("Imagem de referência da espécie (não é esta árvore)"),
    ).toBeInTheDocument();
    expect(within(referencia).getByText(/Maria Fotógrafa/)).toBeInTheDocument();
    expect(within(referencia).getByText(/CC BY-SA 4.0/)).toBeInTheDocument();
  });

  it("sem fotos, mostra o estado vazio com a ação Adicionar foto para quem pode editar", async () => {
    fotos = [];
    const usuario = await abrirGaleria();
    expect(await screen.findByText("Esta árvore ainda não tem fotos")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Comparar" })).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Adicionar foto" }));
    // Leva ao fluxo de envio que já existe, na aba Evidências.
    expect(
      await screen.findByRole("button", { name: /Adicionar foto ou documento/ }),
    ).toBeInTheDocument();
  });

  it("sem permissão de edição, o estado vazio não oferece Adicionar foto", async () => {
    fotos = [];
    permissoes = ["mapa.ler", "inventario.ler"];
    await abrirGaleria();
    expect(await screen.findByText("Esta árvore ainda não tem fotos")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adicionar foto" })).not.toBeInTheDocument();
  });

  it("só oferece Comparar com pelo menos duas fotos", async () => {
    fotos = [FOTOS[0]!];
    await abrirGaleria();
    await screen.findByRole("button", { name: /Abrir foto/ });
    expect(screen.queryByRole("button", { name: /Comparar/ })).not.toBeInTheDocument();
  });

  it("abre a comparação a partir da galeria", async () => {
    const usuario = await abrirGaleria();
    await usuario.click(await screen.findByRole("button", { name: /Comparar/ }));
    const dialogo = await screen.findByRole("dialog", { name: "Comparar fotos" });
    expect(within(dialogo).getByText(/Antes/, { selector: "span" })).toBeInTheDocument();
  });
});

describe("comparar antes e depois", () => {
  it("começa com a mais antiga contra a mais recente, lado a lado, com a data de cada uma", () => {
    render(<ComparadorFotos fotos={FOTOS} codigoArvore="ARV-000001" />);
    const antes = screen.getByRole("img", { name: /^Antes:/ });
    const depois = screen.getByRole("img", { name: /^Depois:/ });
    expect(antes).toHaveAttribute("src", "http://armazenamento.teste/original-1.jpg");
    expect(depois).toHaveAttribute("src", "http://armazenamento.teste/original-3.jpg");
    expect(screen.getByText(/Antes/, { selector: "figcaption span" })).toBeInTheDocument();
    expect(screen.getByText(/01\/03\/2026/, { selector: "figcaption" })).toBeInTheDocument();
    expect(screen.getByText(/20\/08\/2026/, { selector: "figcaption" })).toBeInTheDocument();
  });

  it("troca as fotos escolhidas", async () => {
    const usuario = userEvent.setup();
    render(<ComparadorFotos fotos={FOTOS} codigoArvore="ARV-000001" />);
    await usuario.selectOptions(screen.getByLabelText("Foto de antes"), "f-2");
    expect(screen.getByRole("img", { name: /^Antes:/ })).toHaveAttribute(
      "src",
      "http://armazenamento.teste/original-2.jpg",
    );
  });

  it("na barra deslizante, a posição recorta a foto de antes sobre a de depois", async () => {
    const usuario = userEvent.setup();
    render(<ComparadorFotos fotos={FOTOS} codigoArvore="ARV-000001" />);
    await usuario.click(screen.getByRole("button", { name: "Barra deslizante" }));
    const antes = screen.getByRole("img", { name: /^Antes:/ });
    expect(antes.style.clipPath).toMatch(/^inset\(0(px)? 50% 0px 0px\)$/);
    const barra = screen.getByRole("slider", { name: "Posição da divisória" });
    fireEvent.change(barra, { target: { value: "52" } });
    expect(barra).toHaveValue("52");
    expect(antes.style.clipPath).toMatch(/^inset\(0(px)? 48% 0px 0px\)$/);
    expect(screen.getByText(/Antes · 01\/03\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Depois · 20\/08\/2026/)).toBeInTheDocument();
  });
});

describe("linha do tempo visual", () => {
  it("mostra os eventos com ícone e data; o resumo aparece ao focar", async () => {
    const usuario = await abrirGaleria();
    const marcador = await screen.findByRole("link", { name: /Inspeção INS-000007, 10\/05\/2026/ });
    expect(marcador).toHaveAttribute("href", "/inspecoes/i-1");
    expect(
      screen.getByRole("button", { name: /Cadastro da árvore, 10\/01\/2026/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Poda concluída TAR-000002/ })).toHaveAttribute(
      "href",
      "/equipes-tarefas/t-1",
    );
    // A inspeção validada ganha a cor da condição aparente.
    expect(marcador.style.backgroundColor).toBe("rgb(232, 89, 12)");

    const resumo = screen.getByTestId("resumo-evento");
    expect(resumo).not.toHaveTextContent("Condição aparente: Ruim.");
    act(() => marcador.focus());
    expect(resumo).toHaveTextContent("Condição aparente: Ruim.");
    act(() => marcador.blur());
    expect(resumo).not.toHaveTextContent("Condição aparente: Ruim.");
    await usuario.hover(screen.getByRole("button", { name: /Medição, 01\/02\/2026/ }));
    expect(resumo).toHaveTextContent("Altura total 8 m");
  });

  it("clicar na medição leva à aba Medidas", async () => {
    const usuario = await abrirGaleria();
    await usuario.click(await screen.findByRole("button", { name: /Medição, 01\/02\/2026/ }));
    expect(await screen.findByRole("tab", { name: "Medidas", selected: true })).toBeInTheDocument();
  });

  it("mostra altura e DAP com a unidade", async () => {
    await abrirGaleria();
    expect(await screen.findByText("Altura (m) ao longo do tempo")).toBeInTheDocument();
    expect(screen.getByText("DAP (cm) ao longo do tempo")).toBeInTheDocument();
    expect(screen.getAllByTestId("ponto-altura")).toHaveLength(2);
    expect(
      screen.getByRole("img", { name: /DAP \(cm\): 30 cm em 01\/02\/2026/ }),
    ).toBeInTheDocument();
  });
});

describe("gráfico de condição em degraus", () => {
  it("pinta cada degrau com a cor de condição do mapa e rotula os níveis em texto", () => {
    render(
      <GraficoCondicao
        pontos={[
          { data: "2026-01-01T12:00:00Z", condicao: "boa", inspecao_codigo: "INS-1" },
          { data: "2026-04-01T12:00:00Z", condicao: "regular", inspecao_codigo: "INS-2" },
          { data: "2026-07-01T12:00:00Z", condicao: "morta", inspecao_codigo: "INS-3" },
        ]}
      />,
    );
    expect(screen.getByTestId("ponto-condicao-boa")).toHaveAttribute("fill", CORES_CONDICAO.boa);
    expect(screen.getByTestId("ponto-condicao-regular")).toHaveAttribute(
      "fill",
      CORES_CONDICAO.regular,
    );
    expect(screen.getByTestId("ponto-condicao-morta")).toHaveAttribute(
      "fill",
      CORES_CONDICAO.morta,
    );
    // A cor não é a única pista: os níveis estão escritos e o gráfico tem descrição.
    expect(screen.getByText("Aparentemente morta", { selector: "text" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: /Boa em 01\/01\/2026; Regular em 01\/04\/2026; Aparentemente morta em 01\/07\/2026/,
      }),
    ).toBeInTheDocument();
  });

  it("sem inspeção validada, diz que a condição não foi avaliada em vez de desenhar verde", () => {
    render(<GraficoCondicao pontos={[]} />);
    expect(screen.getByText(/Nenhuma inspeção validada/)).toBeInTheDocument();
    expect(screen.queryByTestId(/ponto-condicao/)).not.toBeInTheDocument();
  });

  it("calcula os degraus: cada condição vale até a inspeção seguinte e a última até hoje", () => {
    const fim = Date.parse("2026-12-01T00:00:00Z");
    const lista = degraus(
      [
        { data: "2026-05-01T00:00:00Z", condicao: "ruim", inspecao_codigo: "B" },
        { data: "2026-01-01T00:00:00Z", condicao: "boa", inspecao_codigo: "A" },
      ],
      fim,
    );
    expect(lista.map((d) => [d.inspecao, d.nivel])).toEqual([
      ["A", "boa"],
      ["B", "ruim"],
    ]);
    expect(lista[0]!.ate).toBe(lista[1]!.de);
    expect(lista[1]!.ate).toBe(fim);
    expect(nivelDaCondicao("qualquer coisa")).toBe("nao_avaliada");
    expect(posicaoNaEscala(5, 5, 5)).toBe(0.5);
  });
});
