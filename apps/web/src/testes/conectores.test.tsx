import { configurarCliente, type Conector, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { conectoresComProblema } from "../layout/fontes";
import { escreverRotulos, lerRotulos } from "../paginas/administracao/conectores";
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

const API = "http://api.teste";

const ADMIN: Eu = {
  id: "u-admin",
  nome: "Ana Admin",
  email: "ana@itree.teste",
  papeis: ["administrador"],
  permissoes: ["admin.configuracao", "alertas.ler", "mapa.ler"],
  territorios: [{ id: "t-mun", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
} as Eu;

const conector = (p: Partial<Conector>): Conector =>
  ({
    id: "c-1",
    nome: "Atendimentos do Plano de Arborização",
    tipo: "geojson_url",
    url: "https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=534",
    parametros: { campo_id: "id" },
    destino: "camada_referencia",
    modelo_importacao: null,
    modelo_importacao_nome: null,
    modo: "criar",
    periodicidade: "mensal",
    ativo: true,
    orgao: "Prefeitura de Fortaleza",
    licenca: "Não declarada pela fonte",
    url_origem: "https://mapas.fortaleza.ce.gov.br/",
    cor: "#7a4fb5",
    rotulos: { name: "Endereço" },
    situacao: "ok",
    ultima_execucao: {
      id: 1,
      origem: "manual",
      usuario_nome: "Ana Admin",
      iniciada_em: new Date(Date.now() - 2 * 3600_000).toISOString(),
      concluida_em: new Date(Date.now() - 2 * 3600_000 + 5000).toISOString(),
      sucesso: true,
      recebidos: 577,
      novos: 577,
      atualizados: 0,
      removidos: 0,
      invalidos: 0,
      erro: "",
      detalhe: "",
      lote: null,
      lote_numero: null,
    },
    total_feicoes: 577,
    previa_pendente: null,
    criado_em: "2026-11-14T10:00:00Z",
    atualizado_em: "2026-11-14T10:00:00Z",
    ...p,
  }) as Conector;

let conectores: Conector[] = [];
const corpos: Record<string, unknown[]> = { criar: [], sincronizar: [], testar: [] };

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(ADMIN)),
  http.get(`${API}/api/v1/alertas/fontes`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/alertas/ingestoes`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/conectores`, () => HttpResponse.json(conectores)),
  http.post(`${API}/api/v1/conectores`, async ({ request }) => {
    corpos.criar!.push(await request.json());
    return HttpResponse.json(conector({ id: "c-novo" }), { status: 201 });
  }),
  http.post(`${API}/api/v1/conectores/testar`, async ({ request }) => {
    corpos.testar!.push(await request.json());
    return HttpResponse.json({
      total: 577,
      paginas: 1,
      colunas: ["id", "name", "ano_ref"],
      amostra: [{ id: "1", name: "Av. João de Araújo Lima, 731", ano_ref: "2021" }],
    });
  }),
  http.post(`${API}/api/v1/conectores/:id/sincronizar`, ({ params }) => {
    corpos.sincronizar!.push(params.id);
    return HttpResponse.json({ id: 9 }, { status: 202 });
  }),
  http.get(`${API}/api/v1/conectores/:id/execucoes`, () =>
    HttpResponse.json([
      {
        id: 3,
        origem: "agendada",
        usuario_nome: null,
        iniciada_em: "2026-11-14T04:10:00Z",
        concluida_em: "2026-11-14T04:10:05Z",
        sucesso: false,
        recebidos: 0,
        novos: 0,
        atualizados: 0,
        removidos: 0,
        invalidos: 0,
        erro: "A fonte respondeu com o código 503.",
        detalhe: "",
        lote: null,
        lote_numero: null,
      },
      {
        id: 2,
        origem: "manual",
        usuario_nome: "Ana Admin",
        iniciada_em: "2026-11-13T12:00:00Z",
        concluida_em: "2026-11-13T12:00:09Z",
        sucesso: true,
        recebidos: 577,
        novos: 3,
        atualizados: 2,
        removidos: 1,
        invalidos: 4,
        erro: "",
        detalhe: "",
        lote: null,
        lote_numero: null,
      },
    ]),
  ),
  http.get(`${API}/api/v1/modelos-importacao`, () =>
    HttpResponse.json({
      count: 1,
      next: null,
      previous: null,
      results: [{ id: "m-1", nome: "Padrão", fonte: "Fortaleza em Mapas", mapeamento: {} }],
    }),
  ),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  conectores = [];
  for (const k of Object.keys(corpos)) corpos[k] = [];
});
afterAll(() => servidor.close());

async function abrir(caminho = "/administracao/integracoes") {
  const { criarRoteador } = await import("../rotas");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={criarRoteador(createMemoryHistory({ initialEntries: [caminho] }))} />
    </QueryClientProvider>,
  );
}

describe("conectores em Administração > Integrações", () => {
  it("lista o conector com destino, estado da última execução e resultado", async () => {
    conectores = [conector({})];
    await abrir();
    const linha = within(
      (await screen.findByRole("cell", { name: /Atendimentos do Plano/ })).closest("tr")!,
    );
    expect(linha.getByText(/GeoJSON por endereço · Mensal/)).toBeInTheDocument();
    expect(linha.getByText("Camada de referência no mapa")).toBeInTheDocument();
    expect(linha.getByText("577 feições")).toBeInTheDocument();
    expect(linha.getByText("Em dia")).toBeInTheDocument();
    expect(linha.getByText("há 2 horas")).toBeInTheDocument();
    expect(linha.getByText(/577 recebidos · 577 novos/)).toBeInTheDocument();
  });

  it("mostra falha, atraso e conector inativo", async () => {
    conectores = [
      conector({
        id: "c-f",
        nome: "Falho",
        situacao: "falha",
        ultima_execucao: {
          ...conector({}).ultima_execucao!,
          sucesso: false,
          erro: "A fonte respondeu com o código 503.",
        },
      }),
      conector({ id: "c-a", nome: "Atrasado", situacao: "atrasado" }),
      conector({
        id: "c-i",
        nome: "Parado",
        ativo: false,
        situacao: "nunca",
        ultima_execucao: null,
      }),
    ];
    await abrir();
    const falho = within((await screen.findByText("Falho", { selector: "p" })).closest("tr")!);
    expect(falho.getByText("Falhou")).toBeInTheDocument();
    expect(falho.getByText("A fonte respondeu com o código 503.")).toBeInTheDocument();
    expect(
      within(screen.getByText("Atrasado", { selector: "p" }).closest("tr")!).getByText("Atrasado", {
        selector: "span.inline-flex",
      }),
    ).toBeInTheDocument();
    const parado = within(screen.getByText("Parado", { selector: "p" }).closest("tr")!);
    expect(parado.getByText("Inativo")).toBeInTheDocument();
    expect(parado.getByText("Nunca sincronizado")).toBeInTheDocument();
  });

  it("destaca a prévia que um conector de lote deixou aguardando", async () => {
    conectores = [conector({ destino: "lote_importacao", previa_pendente: 12, total_feicoes: 0 })];
    await abrir();
    expect(await screen.findByText("Prévia aguardando")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Lote 12: revisar e confirmar/ })).toHaveAttribute(
      "href",
      "/inventario/importacoes",
    );
  });

  it("estado vazio explica o que fazer", async () => {
    await abrir();
    expect(await screen.findByText("Nenhum conector cadastrado")).toBeInTheDocument();
  });

  it("Sincronizar agora chama a API do conector", async () => {
    conectores = [conector({})];
    const usuario = userEvent.setup();
    await abrir();
    await usuario.click(await screen.findByRole("button", { name: /Sincronizar agora/ }));
    await waitFor(() => expect(corpos.sincronizar).toEqual(["c-1"]));
  });

  it("não deixa sincronizar enquanto uma execução está em andamento", async () => {
    conectores = [conector({ situacao: "sincronizando" })];
    await abrir();
    expect(await screen.findByRole("button", { name: /Sincronizar agora/ })).toBeDisabled();
  });

  it("o histórico lista as execuções com o resultado e quem iniciou", async () => {
    conectores = [conector({})];
    const usuario = userEvent.setup();
    await abrir();
    await usuario.click(await screen.findByRole("button", { name: /Histórico de Atendimentos/ }));
    const dialogo = within(await screen.findByRole("dialog"));
    expect(await dialogo.findByText("A fonte respondeu com o código 503.")).toBeInTheDocument();
    expect(dialogo.getByText("Agendador")).toBeInTheDocument();
    expect(
      dialogo.getByText("577 recebidos · 3 novos · 2 atualizados · 1 removidos · 4 inválidos"),
    ).toBeInTheDocument();
    expect(dialogo.getByText("Ana Admin")).toBeInTheDocument();
  });

  it("o formulário testa a conexão sem gravar e mostra a contagem e as colunas", async () => {
    const usuario = userEvent.setup();
    await abrir();
    await usuario.click(await screen.findByRole("button", { name: /Novo conector/ }));
    const dialogo = within(await screen.findByRole("dialog"));
    expect(dialogo.getByRole("button", { name: "Testar conexão" })).toBeDisabled();
    await usuario.type(
      dialogo.getByLabelText(/^Endereço/),
      "https://mapas.fortaleza.ce.gov.br/api/v1/geojson?id=534",
    );
    await usuario.click(dialogo.getByRole("button", { name: "Testar conexão" }));
    expect(await dialogo.findByText("577 feições encontradas")).toBeInTheDocument();
    expect(dialogo.getByText("Colunas: id, name, ano_ref")).toBeInTheDocument();
    expect(dialogo.getByText(/Av\. João de Araújo Lima, 731/)).toBeInTheDocument();
    expect(corpos.testar).toHaveLength(1);
    expect(corpos.criar).toHaveLength(0);
  });

  it("o teste de conexão mostra o motivo da falha", async () => {
    servidor.use(
      http.post(`${API}/api/v1/conectores/testar`, () =>
        HttpResponse.json({ detail: "A fonte respondeu com o código 503." }, { status: 400 }),
      ),
    );
    const usuario = userEvent.setup();
    await abrir();
    await usuario.click(await screen.findByRole("button", { name: /Novo conector/ }));
    const dialogo = within(await screen.findByRole("dialog"));
    await usuario.type(dialogo.getByLabelText(/^Endereço/), "https://mapas.fortaleza.ce.gov.br/x");
    await usuario.click(dialogo.getByRole("button", { name: "Testar conexão" }));
    expect(await dialogo.findByText("A fonte respondeu com o código 503.")).toBeInTheDocument();
  });

  it("cria o conector com atribuição, parâmetros do tipo e rótulos", async () => {
    const usuario = userEvent.setup();
    await abrir();
    await usuario.click(await screen.findByRole("button", { name: /Novo conector/ }));
    const dialogo = within(await screen.findByRole("dialog"));
    await usuario.type(dialogo.getByLabelText(/^Nome/), "Atendimentos");
    await usuario.type(dialogo.getByLabelText(/^Endereço/), "https://mapas.fortaleza.ce.gov.br/g");
    await usuario.type(dialogo.getByLabelText("Propriedade do identificador"), "id");
    await usuario.type(dialogo.getByLabelText(/^Órgão/), "Prefeitura de Fortaleza");
    await usuario.type(dialogo.getByLabelText(/^Licença/), "Não declarada");
    await usuario.type(
      dialogo.getByLabelText(/^Página da fonte/),
      "https://mapas.fortaleza.ce.gov.br/",
    );
    await usuario.type(dialogo.getByLabelText("Rótulos do popup"), "name: Endereço");
    await usuario.click(dialogo.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(corpos.criar).toHaveLength(1));
    expect(corpos.criar![0]).toMatchObject({
      nome: "Atendimentos",
      tipo: "geojson_url",
      destino: "camada_referencia",
      parametros: { campo_id: "id" },
      orgao: "Prefeitura de Fortaleza",
      licenca: "Não declarada",
      rotulos: { name: "Endereço" },
      ativo: false,
    });
  });

  it("o destino lote pede o modelo de importação e o modo", async () => {
    const usuario = userEvent.setup();
    await abrir();
    await usuario.click(await screen.findByRole("button", { name: /Novo conector/ }));
    const dialogo = within(await screen.findByRole("dialog"));
    expect(dialogo.queryByLabelText(/Modelo de importação/)).toBeNull();
    await usuario.selectOptions(dialogo.getByLabelText("Destino"), "lote_importacao");
    expect(
      await dialogo.findByRole("option", { name: "Padrão (Fortaleza em Mapas)" }),
    ).toBeInTheDocument();
    expect(dialogo.getByLabelText(/Modelo de importação/)).toBeInTheDocument();
    expect(dialogo.getByLabelText("Modo")).toBeInTheDocument();
    expect(dialogo.getByText(/nunca é confirmada sozinha/)).toBeInTheDocument();
  });

  it("os parâmetros mudam com o tipo", async () => {
    const usuario = userEvent.setup();
    await abrir();
    await usuario.click(await screen.findByRole("button", { name: /Novo conector/ }));
    const dialogo = within(await screen.findByRole("dialog"));
    await usuario.selectOptions(dialogo.getByLabelText("Tipo"), "wfs");
    expect(dialogo.getByLabelText(/Camada \(typeName\)/)).toBeInTheDocument();
    await usuario.selectOptions(dialogo.getByLabelText("Tipo"), "arcgis_rest");
    expect(dialogo.getByLabelText("Filtro (where)")).toBeInTheDocument();
    expect(dialogo.queryByLabelText(/Camada \(typeName\)/)).toBeNull();
    await usuario.selectOptions(dialogo.getByLabelText("Tipo"), "ckan");
    expect(dialogo.getByLabelText(/Conjunto de dados \(pacote\)/)).toBeInTheDocument();
  });

  it("mostra o erro de validação do servidor no campo", async () => {
    servidor.use(
      http.post(`${API}/api/v1/conectores`, () =>
        HttpResponse.json(
          { url: ["O host exemplo.com não está na lista de fontes permitidas do servidor."] },
          { status: 400 },
        ),
      ),
    );
    const usuario = userEvent.setup();
    await abrir();
    await usuario.click(await screen.findByRole("button", { name: /Novo conector/ }));
    const dialogo = within(await screen.findByRole("dialog"));
    await usuario.click(dialogo.getByRole("button", { name: "Salvar" }));
    expect(await dialogo.findByText(/não está na lista de fontes permitidas/)).toBeInTheDocument();
  });
});

describe("rótulos do popup", () => {
  it("lê e escreve uma propriedade por linha", () => {
    expect(
      lerRotulos("name: Endereço\n\nsem separador\nano_ref : Ano: de referência\n: vazio"),
    ).toEqual({ name: "Endereço", ano_ref: "Ano: de referência" });
    expect(escreverRotulos({ name: "Endereço", fonte: "Fonte" })).toBe(
      "name: Endereço\nfonte: Fonte",
    );
  });
});

describe("conectores no indicador de fontes", () => {
  it("só conector ativo com falha ou atraso entra", () => {
    const lista = [
      conector({ id: "1", nome: "Ok", situacao: "ok" }),
      conector({ id: "2", nome: "Falho", situacao: "falha" }),
      conector({ id: "3", nome: "Atrasado", situacao: "atrasado" }),
      conector({ id: "4", nome: "Inativo falho", situacao: "falha", ativo: false }),
      conector({ id: "5", nome: "Novo", situacao: "nunca" }),
    ];
    expect(conectoresComProblema(lista)).toEqual([
      { fonte: "Falho", motivo: "indisponivel" },
      { fonte: "Atrasado", motivo: "desatualizada" },
    ]);
  });

  it("o cabeçalho avisa quando um conector ativo falhou", async () => {
    conectores = [conector({ nome: "Atendimentos", situacao: "falha" })];
    await abrir("/visao-geral");
    const aviso = await screen.findByRole("link", { name: /1 fonte externa com problema/ });
    expect(aviso).toHaveAttribute("href", "/administracao/integracoes");
    expect(aviso).toHaveAttribute("title", "Atendimentos (indisponível)");
  });
});
