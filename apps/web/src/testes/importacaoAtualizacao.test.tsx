import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

const API = "http://api.teste";

const REVISOR: Eu = {
  id: "u-1",
  nome: "Rita Revisora",
  email: "rita@itree.teste",
  papeis: ["revisor"],
  permissoes: ["inventario.ler", "inventario.importar"],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const lote = (extras: Record<string, unknown>) => ({
  id: "l-2",
  numero: 8,
  arquivo_nome: "inventario.csv",
  formato: "csv",
  fonte: "Inventário 2019",
  data_referencia: null,
  modo: "criar",
  ignorar_duplicatas: false,
  usar_ponto_interior: false,
  resumo: { a_criar: 1, a_atualizar: 1, sem_mudanca: 1, duplicatas: 1, ambiguas: 1 },
  total_linhas: 4,
  linhas_validas: 1,
  arvores_criadas: 0,
  linhas_atualizadas: 0,
  linhas_ignoradas: 0,
  linhas_processadas: 0,
  linhas_com_falha: 0,
  erro: "",
  estado: "pre_visualizado",
  confirmado_em: null,
  criado_em: "2026-11-10T12:00:00Z",
  usuario_nome: "Rita",
  pode_desfazer: false,
  motivo_nao_desfazer: null,
  ...extras,
});

const JA_IMPORTADO = "Identificador já importado anteriormente; a linha será ignorada.";
const LINHAS = [
  {
    indice: 1,
    dados: { id_externo: "A1", endereco: "Rua 1 (nova)" },
    erros: [JA_IMPORTADO],
    avisos: [],
    existente: {
      arvore_id: "a-1",
      codigo: "ARV-000001",
      diferencas: [
        { campo: "endereco", rotulo: "Endereço", antigo: "Rua 1", novo: "Rua 1 (nova)" },
        { campo: "altura", rotulo: "Altura (m)", antigo: "", novo: "9,00" },
      ],
    },
  },
  {
    indice: 2,
    dados: { id_externo: "A2" },
    erros: [JA_IMPORTADO],
    avisos: [],
    existente: { arvore_id: "a-2", codigo: "ARV-000002", diferencas: [] },
  },
  {
    indice: 3,
    dados: { id_externo: "A3", especie_texto: "oiti" },
    erros: [],
    avisos: [
      "Nome popular 'oiti' é ambíguo (Licania tomentosa, Outra); a árvore fica sem espécie.",
    ],
    especie_ambigua: ["Licania tomentosa", "Outra"],
    duplicata: { arvore_id: "a-9", codigo: "ARV-000009", distancia_m: 1.2 },
  },
  { indice: 4, dados: {}, erros: ["Sem coordenadas."], avisos: [] },
];

const confirmacoes: unknown[] = [];
const modelosCriados: unknown[] = [];
const modelosApagados: string[] = [];
const modeloSalvo = {
  id: "m-1",
  nome: "Colunas da SEUMA",
  fonte: "Inventário 2019",
  mapeamento: { latitude: "y", longitude: "x", especie: "popular", id_externo: "inexistente" },
  srid: 31984,
  usar_ponto_interior: false,
  criado_por_nome: "Rita",
  criado_em: "2026-11-01T12:00:00Z",
  atualizado_em: "2026-11-01T12:00:00Z",
};
let fontesConsultadas: string[] = [];
let corposCriar: string[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(REVISOR)),
  http.get(`${API}/api/v1/importacoes`, () =>
    HttpResponse.json({ count: 1, next: null, previous: null, results: [lote({})] }),
  ),
  http.get(`${API}/api/v1/importacoes/l-2`, () =>
    HttpResponse.json({ ...lote({}), linhas: LINHAS, falhas: [] }),
  ),
  http.post(`${API}/api/v1/importacoes/l-2/confirmar`, async ({ request }) => {
    confirmacoes.push(await request.json());
    return HttpResponse.json(lote({ estado: "confirmado" }));
  }),
  http.get(`${API}/api/v1/modelos-importacao`, ({ request }) => {
    const fonte = new URL(request.url).searchParams.get("fonte") ?? "";
    fontesConsultadas.push(fonte);
    return HttpResponse.json({
      count: fonte === "Inventário 2019" ? 1 : 0,
      next: null,
      previous: null,
      results: fonte === "Inventário 2019" ? [modeloSalvo] : [],
    });
  }),
  http.post(`${API}/api/v1/modelos-importacao`, async ({ request }) => {
    modelosCriados.push(await request.json());
    return HttpResponse.json(modeloSalvo, { status: 201 });
  }),
  http.delete(`${API}/api/v1/modelos-importacao/m-1`, () => {
    modelosApagados.push("m-1");
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${API}/api/v1/importacoes`, async ({ request }) => {
    corposCriar.push(await request.text());
    return HttpResponse.json({ ...lote({}), linhas: LINHAS, falhas: [] }, { status: 201 });
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  confirmacoes.length = 0;
  modelosCriados.length = 0;
  modelosApagados.length = 0;
  fontesConsultadas = [];
  corposCriar = [];
});
afterAll(() => servidor.close());

async function abrir() {
  const { criarRoteador } = await import("../rotas");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider
        router={criarRoteador(createMemoryHistory({ initialEntries: ["/inventario/importacoes"] }))}
      />
    </QueryClientProvider>,
  );
}

function colunas(formato: string, extras: Record<string, unknown> = {}) {
  return http.post(`${API}/api/v1/importacoes/colunas`, () =>
    HttpResponse.json({
      formato,
      colunas: ["x", "y", "popular", "cod"],
      total_linhas: 3,
      amostra: [],
      tem_geometria: false,
      ...extras,
    }),
  );
}

async function abrirAssistente(arquivo: File) {
  const usuario = userEvent.setup();
  await abrir();
  await usuario.click((await screen.findAllByRole("button", { name: /Nova importação/ }))[0]!);
  const dialogo = await screen.findByRole("dialog");
  await usuario.upload(within(dialogo).getByLabelText(/Arquivo/, { selector: "input" }), arquivo);
  return { usuario, dialogo };
}

describe("assistente com formatos novos", () => {
  it("aceita planilha XLSX: nomeia o formato e exige latitude e longitude", async () => {
    servidor.use(colunas("xlsx"));
    const { usuario, dialogo } = await abrirAssistente(
      new File(["x"], "arvores.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    expect(await within(dialogo).findByText(/formato XLSX/)).toBeInTheDocument();
    expect(within(dialogo).getByLabelText(/Arquivo/, { selector: "input" })).toHaveAttribute(
      "accept",
      expect.stringContaining(".xlsx"),
    );
    await usuario.type(within(dialogo).getByLabelText(/Fonte dos dados/), "Planilha 2020");
    await usuario.click(within(dialogo).getByRole("button", { name: "Próximo" }));
    // Planilha não tem geometria: latitude e longitude são obrigatórias, como no CSV.
    expect(within(dialogo).getByText("Latitude (ou Y)").textContent).toContain("*");
    expect(within(dialogo).queryByLabelText(/ponto interior/)).toBeNull();
  });

  it("geográfico: esconde latitude/longitude e oferece o ponto interior dos polígonos", async () => {
    servidor.use(colunas("geopackage", { tem_geometria: true }));
    const { usuario, dialogo } = await abrirAssistente(
      new File(["x"], "arvores.gpkg", { type: "application/geopackage+sqlite3" }),
    );
    expect(await within(dialogo).findByText(/formato GeoPackage/)).toBeInTheDocument();
    await usuario.type(within(dialogo).getByLabelText(/Fonte dos dados/), "Cadastro 2022");
    await usuario.click(within(dialogo).getByRole("button", { name: "Próximo" }));
    expect(within(dialogo).queryByText("Latitude (ou Y)")).toBeNull();
    const caixa = within(dialogo).getByLabelText(/Aceitar polígonos pelo ponto interior/);
    expect(caixa).not.toBeChecked();
    await usuario.click(caixa);
    await usuario.click(within(dialogo).getByRole("button", { name: "Pré-visualizar" }));
    await vi.waitFor(() => expect(corposCriar).toHaveLength(1));
    expect(corposCriar[0]).toMatch(/name="usar_ponto_interior"\r\n\r\ntrue/);
  });
});

describe("modelo de importação salvo", () => {
  async function ate2oPasso() {
    servidor.use(colunas("csv"));
    const { usuario, dialogo } = await abrirAssistente(
      new File(["x,y"], "arvores.csv", { type: "text/csv" }),
    );
    await usuario.type(within(dialogo).getByLabelText(/Fonte dos dados/), "Inventário 2019");
    await usuario.click(within(dialogo).getByRole("button", { name: "Próximo" }));
    return { usuario, dialogo };
  }

  it("sugere o modelo da mesma fonte e o aplica só nas colunas que o arquivo tem", async () => {
    const { usuario, dialogo } = await ate2oPasso();
    expect(
      await within(dialogo).findByText(/Há 1 modelo salvo para “Inventário 2019”/),
    ).toBeInTheDocument();
    expect(fontesConsultadas).toContain("Inventário 2019");
    // Antes de aplicar, a sugestão automática por nome de coluna (x/y não casam: vazio).
    await usuario.click(
      within(dialogo).getByRole("button", { name: "Usar o modelo “Colunas da SEUMA”" }),
    );
    expect(within(dialogo).getByLabelText(/Latitude/)).toHaveValue("y");
    expect(within(dialogo).getByLabelText(/Longitude/)).toHaveValue("x");
    expect(within(dialogo).getByLabelText(/Espécie/)).toHaveValue("popular");
    // "inexistente" não é coluna deste arquivo: o campo fica sem correspondência e o aviso diz isso.
    expect(within(dialogo).getByLabelText(/Identificador na fonte/)).toHaveValue("");
    expect(within(dialogo).getByText(/não tem as colunas “inexistente”/)).toBeInTheDocument();
    // O SRC do modelo (SIRGAS 2000 / UTM 24S) também vai junto na pré-visualização.
    await usuario.click(within(dialogo).getByRole("button", { name: "Pré-visualizar" }));
    await vi.waitFor(() => expect(corposCriar).toHaveLength(1));
    expect(corposCriar[0]).toMatch(/name="srid"\r\n\r\n31984/);
    expect(corposCriar[0]).toMatch(/name="campo_latitude"\r\n\r\ny/);
  });

  it("salva o mapeamento atual como modelo, com nome e fonte", async () => {
    const { usuario, dialogo } = await ate2oPasso();
    await within(dialogo).findByText(/Há 1 modelo salvo/);
    const salvar = within(dialogo).getByRole("button", { name: "Salvar modelo" });
    expect(salvar).toBeDisabled();
    await usuario.selectOptions(within(dialogo).getByLabelText(/Latitude/), "y");
    await usuario.selectOptions(within(dialogo).getByLabelText(/Longitude/), "x");
    await usuario.type(
      within(dialogo).getByLabelText("Salvar o mapeamento atual como modelo"),
      "Meu modelo",
    );
    await usuario.click(salvar);
    await vi.waitFor(() => expect(modelosCriados).toHaveLength(1));
    expect(modelosCriados[0]).toMatchObject({
      nome: "Meu modelo",
      fonte: "Inventário 2019",
      mapeamento: { latitude: "y", longitude: "x" },
      srid: 4326,
    });
  });

  it("apaga o modelo só depois da confirmação", async () => {
    const { usuario, dialogo } = await ate2oPasso();
    await within(dialogo).findByText(/Há 1 modelo salvo/);
    await usuario.click(within(dialogo).getByRole("button", { name: "Apagar" }));
    expect(modelosApagados).toEqual([]);
    await usuario.click(within(dialogo).getByRole("button", { name: "Confirmar exclusão" }));
    await vi.waitFor(() => expect(modelosApagados).toEqual(["m-1"]));
  });

  it("sem modelo para a fonte, diz isso e deixa salvar um novo", async () => {
    servidor.use(colunas("csv"));
    const { usuario, dialogo } = await abrirAssistente(
      new File(["x,y"], "arvores.csv", { type: "text/csv" }),
    );
    await usuario.type(within(dialogo).getByLabelText(/Fonte dos dados/), "Fonte nova");
    await usuario.click(within(dialogo).getByRole("button", { name: "Próximo" }));
    expect(
      await within(dialogo).findByText(/Nenhum modelo salvo para esta fonte/),
    ).toBeInTheDocument();
  });
});

describe("pré-visualização: modo e relatório de diferenças", () => {
  async function abrirPrevia() {
    const usuario = userEvent.setup();
    await abrir();
    await usuario.click(await screen.findByRole("button", { name: "Revisar" }));
    return { usuario, dialogo: await screen.findByRole("dialog") };
  }

  it("mostra, para cada existente, os campos que mudam com o valor antigo e o novo", async () => {
    const { dialogo } = await abrirPrevia();
    const diferencas = await within(dialogo).findByRole("list", { name: "Diferenças da linha 1" });
    const itens = within(diferencas).getAllByRole("listitem");
    expect(itens[0]).toHaveTextContent("Endereço: Rua 1 → Rua 1 (nova)");
    expect(itens[1]).toHaveTextContent("Altura (m): vazio → 9,00");
    expect(within(dialogo).getByText("Já existe: ARV-000001")).toBeInTheDocument();
    expect(within(dialogo).getByText("Sem mudanças.")).toBeInTheDocument();
    // O aviso de "já importado" deixa de aparecer como erro das linhas existentes.
    expect(within(dialogo).queryByText(JA_IMPORTADO)).toBeNull();
    expect(within(dialogo).getByText(/Nome popular 'oiti' é ambíguo/)).toBeInTheDocument();
    expect(
      within(dialogo).getByText(/1 linha tem nome popular ambíguo e ficará/),
    ).toBeInTheDocument();
  });

  it("por padrão só cria; escolher atualizar muda o botão e vai na confirmação", async () => {
    const { usuario, dialogo } = await abrirPrevia();
    await within(dialogo).findByText("Se o identificador já existir na fonte");
    const criar = within(dialogo).getByRole("radio", { name: /Criar só as novas/ });
    const atualizar = within(dialogo).getByRole("radio", { name: /atualizar as existentes/ });
    expect(criar).toBeChecked();
    expect(within(dialogo).getByRole("button", { name: "Importar 1 árvore" })).toBeInTheDocument();

    await usuario.click(atualizar);
    const botao = within(dialogo).getByRole("button", {
      name: "Importar 1 nova e atualizar 1 árvore",
    });
    await usuario.click(botao);
    await vi.waitFor(() =>
      expect(confirmacoes).toEqual([{ modo: "atualizar", ignorar_duplicatas: false }]),
    );
  });

  it("ignorar duplicatas reduz o que será criado e vai na confirmação", async () => {
    const { usuario, dialogo } = await abrirPrevia();
    const caixa = await within(dialogo).findByRole("checkbox", {
      name: /Ignorar 1 linha apontada como possível duplicata/,
    });
    await usuario.click(caixa);
    // A única linha nova era a duplicata: não sobra nada a criar, e o botão fica desligado.
    expect(within(dialogo).getByRole("button", { name: "Importar 0 árvores" })).toBeDisabled();
    await usuario.click(within(dialogo).getByRole("radio", { name: /atualizar as existentes/ }));
    await usuario.click(
      within(dialogo).getByRole("button", { name: "Importar 0 novas e atualizar 1 árvore" }),
    );
    await vi.waitFor(() =>
      expect(confirmacoes).toEqual([{ modo: "atualizar", ignorar_duplicatas: true }]),
    );
  });

  it("o filtro Atualizações lista só as linhas com diferenças", async () => {
    const { usuario, dialogo } = await abrirPrevia();
    await within(dialogo).findByRole("list", { name: "Diferenças da linha 1" });
    await usuario.click(within(dialogo).getByRole("button", { name: "Atualizações" }));
    expect(
      within(dialogo).getByRole("list", { name: "Diferenças da linha 1" }),
    ).toBeInTheDocument();
    expect(within(dialogo).queryByText("Já existe: ARV-000002")).toBeNull();
    await usuario.click(within(dialogo).getByRole("button", { name: "Com erro" }));
    // Linhas existentes não contam como erro; só a linha 4 (sem coordenadas).
    expect(within(dialogo).getByText("Sem coordenadas.")).toBeInTheDocument();
    expect(within(dialogo).queryByText("Já existe: ARV-000001")).toBeNull();
  });
});
