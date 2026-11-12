import { configurarCliente, type Eu } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { criarServidor } from "./servidorPadrao";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

const GESTOR: Eu = {
  id: "u-ges",
  nome: "Gabriel Gestor",
  email: "gabriel@itree.teste",
  papeis: ["gestor"],
  permissoes: [
    "inspecoes.ler",
    "inspecoes.validar",
    "ocorrencias.ler",
    "ocorrencias.editar",
    "tarefas.ler",
    "tarefas.editar",
    "relatorios.ler",
    "relatorios.exportar",
    "inventario.ler",
    "admin.equipes",
  ],
  territorios: [{ id: "t", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "desenvolvimento",
};

const pagina = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
const arvore = {
  id: "a-1",
  codigo: "ARV-000010",
  especie: null,
  especie_estado: "informada",
  localizacao: { longitude: -38.5, latitude: -3.7 },
  localizacao_origem: "importada",
  precisao_m: null,
  endereco: "Rua 1",
  bairro: "Meireles",
  condicao_aparente: "",
  condicao_aparente_em: null,
};
const tecnico = { id: "u-tec", nome: "Tiago Técnico", email: "t@itree.teste" };
const inspecao = (id: string, codigo: string, sinais: string[]) => ({
  id,
  codigo,
  arvore,
  tecnico,
  realizada_em: "2026-10-30T13:00:00Z",
  recebida_em: "2026-10-30T15:00:00Z",
  estado: "em_revisao",
  condicao_aparente: "ruim",
  sinais,
  especie: null,
  especie_texto: "",
  requer_encaminhamento: true,
  origem: "app",
  revisor: null,
  validada_em: null,
  versao: 1,
  localizacao: null,
  precisao_m: null,
  arvore_confirmada: true,
  observacoes: "",
  motivo_devolucao: "",
  aplicado_ao_cadastro: [],
  dispositivo: "",
  medidas: [],
  anterior: null,
  tarefa: null,
  ocorrencias_geradas: [],
});
const equipe = (id: string, nome: string, membros: unknown[], territorios: unknown[]) => ({
  id,
  nome,
  descricao: "",
  ativa: true,
  coordenador: null,
  membros,
  territorios,
});
const tarefa = {
  id: "tf-1",
  codigo: "TAR-000001",
  tipo: "inspecao_arvore",
  descricao: "",
  alvo: { tipo: "arvore", id: "a-1", codigo: "ARV-000237" },
  responsavel: null,
  equipe: null,
  prazo: null,
  atrasada: false,
  estado: "nao_iniciada",
  motivo_estado: "",
  transicoes_possiveis: ["em_execucao", "bloqueada", "cancelada"],
};

let evidencias: unknown[] = [];
const consultasOcorrencias: URLSearchParams[] = [];
const consultasInspecoes: URLSearchParams[] = [];
const encaminhamentos: unknown[] = [];
const transicoesTarefa: unknown[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(GESTOR)),
  http.get(`${API}/api/v1/territorios`, () => HttpResponse.json(pagina([]))),
  http.get(`${API}/api/v1/inspecoes`, ({ request }) => {
    consultasInspecoes.push(new URL(request.url).searchParams);
    return HttpResponse.json(
      pagina([
        inspecao("i-1", "INS-000001", ["fungos", "cavidade", "rachadura"]),
        inspecao("i-2", "INS-000002", ["fungos"]),
      ]),
    );
  }),
  http.get(`${API}/api/v1/inspecoes/i-1`, () =>
    HttpResponse.json(inspecao("i-1", "INS-000001", ["fungos"])),
  ),
  http.get(`${API}/api/v1/inspecoes/i-1/historico`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/evidencias`, () => HttpResponse.json(evidencias)),
  http.get(`${API}/api/v1/ocorrencias`, ({ request }) => {
    consultasOcorrencias.push(new URL(request.url).searchParams);
    return HttpResponse.json(pagina([]));
  }),
  http.get(`${API}/api/v1/tipos-ocorrencia`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/equipes`, () =>
    HttpResponse.json(
      pagina([
        equipe("e-1", "Equipe Leste", [tecnico, tecnico], [{ id: "b", nome: "Meireles" }]),
        equipe("e-2", "Equipe de Poda Oeste", [], []),
      ]),
    ),
  ),
  http.get(`${API}/api/v1/tarefas`, () => HttpResponse.json(pagina([tarefa]))),
  http.get(`${API}/api/v1/relatorios/catalogo`, () =>
    HttpResponse.json({
      analises: [{ id: "arvores_por_bairro", titulo: "Árvores por bairro", definicao: "d" }],
    }),
  ),
  http.get(`${API}/api/v1/relatorios/analise`, () =>
    HttpResponse.json({
      id: "arvores_por_bairro",
      titulo: "Árvores por bairro",
      definicao: "d",
      fonte: "Registros da plataforma",
      periodo: { inicio: "2025-11-10", fim: "2026-11-10" },
      calculado_em: "2026-11-10T12:00:00Z",
      por_bairro: true,
      linhas: [
        { rotulo: "A", valor: 88 },
        { rotulo: "B", valor: 85 },
      ],
      total: 173,
    }),
  ),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "t" });
});
afterEach(() => {
  servidor.resetHandlers();
  evidencias = [];
  consultasOcorrencias.length = 0;
  consultasInspecoes.length = 0;
  encaminhamentos.length = 0;
  transicoesTarefa.length = 0;
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

describe("inspeções", () => {
  it("lista sinais no singular e no plural e mostra há quanto tempo aguarda", async () => {
    await abrir("/inspecoes");
    expect(await screen.findByText("3 sinais")).toBeInTheDocument();
    expect(screen.getByText("1 sinal")).toBeInTheDocument();
    expect(screen.queryByText(/sinal\(is\)/)).toBeNull();
    expect(screen.getAllByText(/aguarda há \d+ dias/).length).toBe(2);
  });

  it("a fila abre pelas mais antigas e ordena e filtra por condição e por encaminhamento", async () => {
    const usuario = userEvent.setup();
    await abrir("/inspecoes");
    await screen.findByText("INS-000001");
    const ultima = () => consultasInspecoes[consultasInspecoes.length - 1]!;
    expect(ultima().get("estado")).toBe("em_revisao");
    expect(ultima().get("ordenar")).toBe("recebida_em");
    expect(ultima().get("requer_encaminhamento")).toBeNull();

    await usuario.selectOptions(screen.getByLabelText("Ordenar por"), "condicao");
    await vi.waitFor(() => expect(ultima().get("ordenar")).toBe("condicao"));
    await usuario.selectOptions(screen.getByLabelText("Condição aparente"), "ruim");
    await vi.waitFor(() => expect(ultima().get("condicao")).toBe("ruim"));
    await usuario.click(screen.getByRole("checkbox", { name: "Requer encaminhamento" }));
    await vi.waitFor(() => expect(ultima().get("requer_encaminhamento")).toBe("true"));
    // Os três filtros valem juntos.
    expect(ultima().get("ordenar")).toBe("condicao");
    expect(ultima().get("condicao")).toBe("ruim");
  });

  it('mostra "chegou hoje" só para quem chegou hoje', async () => {
    const agora = new Date().toISOString();
    servidor.use(
      http.get(`${API}/api/v1/inspecoes`, () =>
        HttpResponse.json(
          pagina([
            { ...inspecao("i-1", "INS-000001", []), recebida_em: agora },
            inspecao("i-2", "INS-000002", []),
          ]),
        ),
      ),
    );
    await abrir("/inspecoes");
    await screen.findByText("INS-000001");
    expect(screen.getAllByText("chegou hoje")).toHaveLength(1);
    expect(screen.getAllByText(/aguarda há \d+ dias/)).toHaveLength(1);
  });

  it('com "requer encaminhamento", "Validar e encaminhar" é a ação principal e abre a ocorrência', async () => {
    const usuario = userEvent.setup();
    servidor.use(
      http.get(`${API}/api/v1/tipos-ocorrencia`, () =>
        HttpResponse.json([
          { id: "tp-1", nome: "Galho caído", descricao: "", prazo_padrao_dias: 3, ativo: true },
        ]),
      ),
      http.post(`${API}/api/v1/inspecoes/i-1/validar-e-encaminhar`, async ({ request }) => {
        encaminhamentos.push(await request.json());
        return HttpResponse.json({
          inspecao: inspecao("i-1", "INS-000001", []),
          ocorrencia: { id: "o-9", codigo: "OCO-000009" },
          tarefa: null,
        });
      }),
      http.get(`${API}/api/v1/ocorrencias/o-9`, () => new HttpResponse(null, { status: 404 })),
    );
    await abrir("/inspecoes/i-1");
    const barra = await screen.findByRole("region", { name: "Decisão da revisão" });
    const encaminhar = within(barra).getByRole("button", { name: "Validar e encaminhar…" });
    expect(encaminhar.className).toMatch(/bg-marca/);
    expect(within(barra).getByRole("button", { name: "Validar…" }).className).not.toMatch(
      /bg-marca/,
    );
    await usuario.click(encaminhar);
    const dialogo = await screen.findByRole("dialog");
    const confirmar = within(dialogo).getByRole("button", { name: "Validar e encaminhar" });
    expect(confirmar).toBeDisabled();
    await usuario.selectOptions(await within(dialogo).findByLabelText(/^Tipo/), "tp-1");
    await usuario.type(within(dialogo).getByLabelText(/O que deve ser atendido/), "Galho solto");
    await usuario.click(confirmar);
    await vi.waitFor(() =>
      expect(encaminhamentos).toEqual([
        expect.objectContaining({
          tipo_id: "tp-1",
          descricao: "Galho solto",
          criar_tarefa: false,
        }),
      ]),
    );
  });

  it('sem "requer encaminhamento", encaminhar fica como ação secundária', async () => {
    servidor.use(
      http.get(`${API}/api/v1/inspecoes/i-1`, () =>
        HttpResponse.json({
          ...inspecao("i-1", "INS-000001", []),
          requer_encaminhamento: false,
        }),
      ),
    );
    await abrir("/inspecoes/i-1");
    const barra = await screen.findByRole("region", { name: "Decisão da revisão" });
    expect(
      within(barra).getByRole("button", { name: "Validar e encaminhar…" }).className,
    ).not.toMatch(/bg-marca/);
    expect(within(barra).getByRole("button", { name: "Validar…" }).className).toMatch(/bg-marca/);
  });

  it("reserva espaço no fim da página para a barra de decisão não cobrir o conteúdo", async () => {
    await abrir("/inspecoes/i-1");
    const barra = await screen.findByRole("region", { name: "Decisão da revisão" });
    const reserva = barra.previousElementSibling as HTMLElement;
    expect(reserva).toHaveAttribute("data-reserva-barra");
    expect(reserva.className).toMatch(/\bh-20\b/);
  });

  it("depois de validada, mostra a ocorrência aberta com link", async () => {
    servidor.use(
      http.get(`${API}/api/v1/inspecoes/i-1`, () =>
        HttpResponse.json({
          ...inspecao("i-1", "INS-000001", []),
          estado: "validada",
          revisor: tecnico,
          validada_em: "2026-10-31T10:00:00Z",
          ocorrencias_geradas: [{ id: "o-9", codigo: "OCO-000009", estado: "aberta" }],
        }),
      ),
    );
    await abrir("/inspecoes/i-1");
    const link = await screen.findByRole("link", { name: "OCO-000009" });
    expect(link).toHaveAttribute("href", "/ocorrencias/o-9");
  });

  it("revisão sem evidências avisa no ponto de decisão e recolhe o histórico", async () => {
    await abrir("/inspecoes/i-1");
    const barra = await screen.findByRole("region", { name: "Decisão da revisão" });
    expect(await within(barra).findByText(/Sem evidências anexadas/)).toBeInTheDocument();
    expect(within(barra).getByRole("button", { name: "Validar…" })).toBeInTheDocument();
    const historico = screen.getByText("Histórico técnico").closest("details")!;
    expect(historico).not.toHaveAttribute("open");
  });

  it("com evidência anexada o aviso some", async () => {
    evidencias = [
      {
        id: "ev-1",
        nome_original: "foto.jpg",
        descricao: "Base do tronco",
        url: "http://x/foto.jpg",
        eh_imagem: true,
        enviada_por_nome: "Tiago",
        criado_em: "2026-10-30T13:00:00Z",
        capturada_em: null,
      },
    ];
    await abrir("/inspecoes/i-1");
    const barra = await screen.findByRole("region", { name: "Decisão da revisão" });
    await screen.findByAltText("Base do tronco");
    expect(within(barra).queryByText(/Sem evidências anexadas/)).toBeNull();
  });
});

describe("ocorrências", () => {
  it("abre em aberto e ordenada por urgência", async () => {
    await abrir("/ocorrencias");
    await screen.findByText("Ainda não há ocorrências registradas");
    expect(consultasOcorrencias[0]?.get("estado")).toBe("abertas");
    expect(consultasOcorrencias[0]?.get("ordenar")).toBe("urgencia");
  });
});

describe("equipes e tarefas", () => {
  it("deixa uma ação principal na linha e move cancelar e bloquear para o menu", async () => {
    const usuario = userEvent.setup();
    await abrir("/equipes-tarefas");
    const linha = (await screen.findByText("TAR-000001")).closest("tr")!;
    expect(within(linha).getByRole("button", { name: "Iniciar" })).toBeInTheDocument();
    expect(within(linha).queryByRole("button", { name: "Cancelar" })).toBeNull();
    await usuario.click(within(linha).getByRole("button", { name: /Mais ações de TAR-000001/ }));
    expect(await screen.findByRole("menuitem", { name: "Cancelar" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Marcar como bloqueada" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Reatribuir" })).toBeInTheDocument();
  });

  it("tarefa bloqueada não oferece Iniciar: a ação principal é Desbloquear, com motivo", async () => {
    const usuario = userEvent.setup();
    servidor.use(
      http.get(`${API}/api/v1/tarefas`, () =>
        HttpResponse.json(
          pagina([
            {
              ...tarefa,
              estado: "bloqueada",
              motivo_estado: "Acesso bloqueado por obra no local",
              transicoes_possiveis: ["nao_iniciada", "em_execucao", "cancelada"],
            },
          ]),
        ),
      ),
      http.post(`${API}/api/v1/tarefas/tf-1/transicao`, async ({ request }) => {
        transicoesTarefa.push(await request.json());
        return HttpResponse.json({ ...tarefa, estado: "nao_iniciada" });
      }),
    );
    await abrir("/equipes-tarefas");
    const linha = (await screen.findByText("TAR-000001")).closest("tr")!;
    expect(within(linha).queryByRole("button", { name: "Iniciar" })).toBeNull();
    expect(within(linha).getByText("Acesso bloqueado por obra no local")).toBeInTheDocument();
    await usuario.click(within(linha).getByRole("button", { name: /Mais ações de TAR-000001/ }));
    expect(screen.queryByRole("menuitem", { name: "Iniciar" })).toBeNull();
    await usuario.keyboard("{Escape}");

    await usuario.click(within(linha).getByRole("button", { name: "Desbloquear" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/Bloqueada por: Acesso bloqueado/)).toBeInTheDocument();
    const confirmar = within(dialogo).getByRole("button", { name: "Confirmar" });
    expect(confirmar).toBeDisabled();
    await usuario.type(
      within(dialogo).getByLabelText(/Por que o bloqueio acabou/),
      "Obra terminou",
    );
    await usuario.click(confirmar);
    await vi.waitFor(() =>
      expect(transicoesTarefa).toEqual([{ estado: "nao_iniciada", motivo: "Obra terminou" }]),
    );
  });

  it("mostra na linha a inspeção de origem da tarefa de atendimento", async () => {
    servidor.use(
      http.get(`${API}/api/v1/tarefas`, () =>
        HttpResponse.json(
          pagina([
            {
              ...tarefa,
              tipo: "atendimento_ocorrencia",
              alvo: { tipo: "ocorrencia", id: "o-1", codigo: "OCO-000007" },
              origem: { tipo: "inspecao", id: "i-1", codigo: "INS-000001" },
            },
          ]),
        ),
      ),
    );
    await abrir("/equipes-tarefas");
    const linha = (await screen.findByText("TAR-000001")).closest("tr")!;
    expect(within(linha).getByRole("link", { name: "INS-000001" })).toHaveAttribute(
      "href",
      "/inspecoes/i-1",
    );
  });

  it("tarefa sem origem de inspeção não mostra a linha de origem", async () => {
    await abrir("/equipes-tarefas");
    const linha = (await screen.findByText("TAR-000001")).closest("tr")!;
    expect(within(linha).queryByText(/Origem:/)).toBeNull();
  });

  it("cartões de equipe usam plural correto e marcam equipe incompleta", async () => {
    await abrir("/equipes-tarefas");
    expect(await screen.findByText(/2 membros · Meireles/)).toBeInTheDocument();
    expect(screen.getByText(/0 membros · sem território/)).toBeInTheDocument();
    expect(screen.getAllByText("Incompleta")).toHaveLength(1);
  });
});

describe("administração de equipes", () => {
  it("equipe ativa sem membros nem território mostra o próximo passo", async () => {
    await abrir("/administracao/equipes");
    expect(
      await screen.findByText("Adicione membros e território para receber tarefas."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Incompleta")).toHaveLength(1);
  });
});

describe("análises", () => {
  it("agrupa exportações num menu, com GeoJSON padronizado, e mostra o total", async () => {
    const usuario = userEvent.setup();
    await abrir("/analises");
    expect(await screen.findByText("Total")).toBeInTheDocument();
    expect(screen.getByText("173")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /GEOJSON/ })).toBeNull();
    await usuario.click(screen.getByRole("button", { name: /Exportar dados/ }));
    expect(
      await screen.findByRole("menuitem", { name: "Inventário (GeoJSON)" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(9);
  });

  it("mostra a evolução mensal ao lado da tabela, com legenda e tabela equivalente", async () => {
    servidor.use(
      http.get(`${API}/api/v1/relatorios/analise`, () =>
        HttpResponse.json({
          id: "inspecoes_por_mes",
          titulo: "Inspeções por mês",
          definicao: "d",
          fonte: "Registros da plataforma",
          periodo: { inicio: "2026-09-01", fim: "2026-11-10" },
          calculado_em: "2026-11-10T12:00:00Z",
          por_bairro: false,
          linhas: [{ rotulo: "10/2026", valor: 4 }],
          total: 4,
          serie_mensal: {
            meses: ["2026-09", "2026-10", "2026-11"],
            series: [{ id: "inspecoes", rotulo: "Inspeções", valores: [0, 4, 1] }],
          },
        }),
      ),
    );
    const usuario = userEvent.setup();
    await abrir("/analises");
    expect(await screen.findByRole("heading", { name: "Evolução mensal" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Evolução mensal: Inspeções, de set\/26 a nov\/26/ }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Legenda" })).getByText("Inspeções"),
    ).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Ver em tabela" }));
    expect(screen.getByRole("cell", { name: "out/26" })).toBeInTheDocument();
  });

  it("mostra a composição de cada linha, a fonte e as ressalvas do manejo da URBFOR", async () => {
    servidor.use(
      http.get(`${API}/api/v1/relatorios/analise`, () =>
        HttpResponse.json({
          id: "manejo_urbfor_por_bairro",
          titulo: "Manejo registrado pela URBFOR (2023)",
          definicao:
            "Árvores com poda, supressão ou recolhimento registrados pela URBFOR em 2023. Ressalvas: (1) a URBFOR publicou planilhas mensais sem coordenadas.",
          fonte:
            "URBFOR (Autarquia de Urbanismo e Paisagismo de Fortaleza), dados abertos de Fortaleza (https://dados.fortaleza.ce.gov.br/dataset/podas_recolhimento_supressao). Licença: não declarada (em definição pela prefeitura).",
          periodo: { inicio: "2025-11-10", fim: "2026-11-10" },
          calculado_em: "2026-11-10T12:00:00Z",
          por_bairro: true,
          unidade: "",
          base_rotulo: "árvores",
          linhas: [
            { rotulo: "Aldeota", valor: 298, detalhe: "Poda 278 · Supressão 18 · Recolhimento 2" },
            {
              rotulo: "Sem bairro identificado",
              valor: 120,
              detalhe: "Poda 100 · Supressão 20",
              territorio_id: null,
            },
          ],
          total: 418,
        }),
      ),
    );
    await abrir("/analises");
    expect(
      await screen.findByRole("heading", { name: "Manejo registrado pela URBFOR (2023)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Poda 278 · Supressão 18 · Recolhimento 2")).toBeInTheDocument();
    expect(screen.getByText("Sem bairro identificado")).toBeInTheDocument();
    expect(screen.getByText("Poda 100 · Supressão 20")).toBeInTheDocument();
    expect(screen.getByText(/sem coordenadas/)).toBeInTheDocument();
    expect(
      screen.getByText(/Licença: não declarada \(em definição pela prefeitura\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("418")).toBeInTheDocument();
  });

  it("sem série mensal (análise sem dimensão temporal) não desenha o gráfico", async () => {
    await abrir("/analises");
    await screen.findByText("Total");
    expect(screen.queryByRole("heading", { name: "Evolução mensal" })).toBeNull();
  });
});

/** Grupo de auditoria como o servidor devolve: eventos iguais, com a contagem total. */
const grupo = <T extends { id: string }>(eventos: T[], quantidade = eventos.length) => ({
  id: eventos[0]!.id,
  quantidade,
  truncado: quantidade > eventos.length,
  eventos,
});

describe("auditoria", () => {
  const evento = (id: string, parcial: Record<string, unknown>) => ({
    id,
    momento: "2026-11-10T21:17:10Z",
    entidade: "Medida",
    entidade_modelo: "inventario.Medida",
    objeto_id: id,
    registro: null,
    pai: null,
    acao: "criacao",
    diferencas: null,
    dados: {},
    autor_nome: null,
    contexto: null,
    ...parcial,
  });

  it("mostra o registro pai de medida e evidência, com link para a árvore e a inspeção", async () => {
    servidor.use(
      http.get(`${API}/api/v1/eu`, () =>
        HttpResponse.json({ ...GESTOR, permissoes: [...GESTOR.permissoes, "admin.auditoria"] }),
      ),
      http.get(`${API}/api/v1/admin/auditoria`, () =>
        HttpResponse.json(
          pagina([
            grupo([evento("m-1", { pai: { tipo: "arvore", id: "a-1", codigo: "ARV-000010" } })]),
            grupo([
              evento("e-1", {
                entidade: "Evidência",
                entidade_modelo: "evidencias.Evidencia",
                pai: { tipo: "inspecao", id: "i-1", codigo: "INS-000001" },
              }),
            ]),
          ]),
        ),
      ),
    );
    await abrir("/administracao/auditoria");
    const arvoreLink = await screen.findByRole("link", { name: /ARV-000010/ });
    expect(arvoreLink).toHaveAttribute("href", "/inventario/arvores/a-1");
    expect(screen.getByRole("link", { name: /INS-000001/ })).toHaveAttribute(
      "href",
      "/inspecoes/i-1",
    );
  });
});

describe("auditoria: lote de filhos", () => {
  it("rotula cada grupo vindo do servidor com o pai e a contagem", async () => {
    const medida = (id: string, pai: string, codigo: string) => ({
      id,
      momento: "2026-11-10T21:17:10Z",
      entidade: "Medida",
      entidade_modelo: "inventario.Medida",
      objeto_id: id,
      registro: null,
      pai: { tipo: "arvore", id: pai, codigo },
      acao: "criacao",
      diferencas: null,
      dados: {},
      autor_nome: null,
      contexto: null,
    });
    servidor.use(
      http.get(`${API}/api/v1/eu`, () =>
        HttpResponse.json({ ...GESTOR, permissoes: [...GESTOR.permissoes, "admin.auditoria"] }),
      ),
      http.get(`${API}/api/v1/admin/auditoria`, () =>
        HttpResponse.json(
          pagina([
            grupo([medida("m-1", "a-1", "ARV-000010"), medida("m-2", "a-1", "ARV-000010")]),
            grupo([medida("m-3", "a-2", "ARV-000011"), medida("m-4", "a-2", "ARV-000011")]),
          ]),
        ),
      ),
    );
    await abrir("/administracao/auditoria");
    expect(await screen.findByRole("link", { name: /ARV-000010/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ARV-000011/ })).toBeInTheDocument();
    expect(screen.getAllByText(/2 registros/)).toHaveLength(2);
  });
});

describe("auditoria: usuário afetado e contagem (R2-18)", () => {
  const eventoUsuario = (id: string, dados: Record<string, unknown>, contexto: unknown = null) => ({
    id,
    momento: "2026-11-10T21:17:10Z",
    entidade: "Usuário",
    entidade_modelo: "contas.UsuarioEvent",
    objeto_id: `u-${id}`,
    registro: null,
    pai: null,
    acao: "alteracao",
    diferencas: null,
    dados,
    autor_nome: null,
    contexto,
  });

  it("identifica o usuário nos eventos de usuário e explica o primeiro acesso", async () => {
    servidor.use(
      http.get(`${API}/api/v1/eu`, () =>
        HttpResponse.json({ ...GESTOR, permissoes: [...GESTOR.permissoes, "admin.auditoria"] }),
      ),
      http.get(`${API}/api/v1/admin/auditoria`, () =>
        HttpResponse.json(
          pagina([
            grupo([
              eventoUsuario(
                "1",
                { nome: "Bia Souza", email: "bia@itree.teste" },
                {
                  evento: "vinculo_oidc",
                },
              ),
            ]),
            grupo([eventoUsuario("2", { nome: "", email: "caio@itree.teste" })]),
          ]),
        ),
      ),
    );
    await abrir("/administracao/auditoria");
    expect(await screen.findByRole("link", { name: "Bia Souza" })).toHaveAttribute(
      "href",
      "/administracao/usuarios/u-1",
    );
    expect(screen.getByRole("link", { name: "caio@itree.teste" })).toBeInTheDocument();
    expect(screen.getByText("Sistema: vínculo da conta no primeiro acesso")).toBeInTheDocument();
    expect(screen.queryByText(/Primeiro acesso \(provedor de login\)/)).toBeNull();
  });

  it("o rodapé conta grupos e diz quantos eventos a página tem", async () => {
    const lote = (id: string) => eventoUsuario(id, { nome: "Ana", email: "a@itree.teste" });
    servidor.use(
      http.get(`${API}/api/v1/eu`, () =>
        HttpResponse.json({ ...GESTOR, permissoes: [...GESTOR.permissoes, "admin.auditoria"] }),
      ),
      http.get(`${API}/api/v1/admin/auditoria`, () =>
        HttpResponse.json({
          count: 2022,
          next: null,
          previous: null,
          results: [grupo([lote("1"), lote("2")], 7)],
        }),
      ),
    );
    await abrir("/administracao/auditoria");
    expect(
      await screen.findByText("1–50 de 2.022 grupos de eventos (7 eventos nesta página)"),
    ).toBeInTheDocument();
    expect(screen.getByText("7 alterados")).toBeInTheDocument();
  });

  it("o cliente não agrupa: grupos vizinhos iguais continuam em linhas separadas", async () => {
    const igual = (id: string) => eventoUsuario(id, { nome: "Ana", email: "a@itree.teste" });
    servidor.use(
      http.get(`${API}/api/v1/eu`, () =>
        HttpResponse.json({ ...GESTOR, permissoes: [...GESTOR.permissoes, "admin.auditoria"] }),
      ),
      http.get(`${API}/api/v1/admin/auditoria`, () =>
        HttpResponse.json(pagina([grupo([igual("1")]), grupo([igual("2")])])),
      ),
    );
    await abrir("/administracao/auditoria");
    await screen.findAllByRole("link", { name: "Ana" });
    expect(screen.getAllByRole("link", { name: "Ana" })).toHaveLength(2);
    expect(screen.queryByText(/\d+ registros/)).toBeNull();
  });

  it("avisa quando o grupo traz só os eventos mais recentes", async () => {
    const usuario = userEvent.setup();
    const igual = (id: string) => eventoUsuario(id, { nome: "Ana", email: "a@itree.teste" });
    servidor.use(
      http.get(`${API}/api/v1/eu`, () =>
        HttpResponse.json({ ...GESTOR, permissoes: [...GESTOR.permissoes, "admin.auditoria"] }),
      ),
      http.get(`${API}/api/v1/admin/auditoria`, () =>
        HttpResponse.json(pagina([grupo([igual("1"), igual("2")], 250)])),
      ),
    );
    await abrir("/administracao/auditoria");
    await usuario.click(await screen.findByRole("button", { name: "Ver detalhes" }));
    expect(
      await screen.findByText(/Mostrando os 2 eventos mais recentes de 250/),
    ).toBeInTheDocument();
  });
});

describe("atribuição a equipe incompleta", () => {
  it("avisa antes de confirmar, sem bloquear a reatribuição", async () => {
    const usuario = userEvent.setup();
    await abrir("/equipes-tarefas");
    const linha = (await screen.findByText("TAR-000001")).closest("tr")!;
    await usuario.click(within(linha).getByRole("button", { name: /Mais ações de TAR-000001/ }));
    await usuario.click(await screen.findByRole("menuitem", { name: "Reatribuir" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).queryByRole("note")).toBeNull();

    await usuario.selectOptions(within(dialogo).getByLabelText("Equipe"), "e-2");
    expect(await within(dialogo).findByRole("note")).toHaveTextContent(
      /Equipe de Poda Oeste está incompleta \(sem membros e sem território\)/,
    );
    await usuario.type(within(dialogo).getByLabelText(/Motivo/), "Reforço");
    expect(within(dialogo).getByRole("button", { name: "Salvar" })).toBeEnabled();

    await usuario.selectOptions(within(dialogo).getByLabelText("Equipe"), "e-1");
    expect(within(dialogo).queryByRole("note")).toBeNull();
  });
});

const ZERADAS = {
  aberta: 0,
  em_triagem: 0,
  encaminhada: 0,
  em_atendimento: 0,
  concluida: 0,
  cancelada: 0,
};

describe("tipos de ocorrência (administração)", () => {
  it("tem ação Editar explícita por linha e legenda de situações em ordem fixa", async () => {
    servidor.use(
      http.get(`${API}/api/v1/eu`, () =>
        HttpResponse.json({ ...GESTOR, permissoes: [...GESTOR.permissoes, "admin.configuracao"] }),
      ),
      http.get(`${API}/api/v1/tipos-ocorrencia`, () =>
        HttpResponse.json([
          {
            id: "t-1",
            nome: "Risco de queda",
            descricao: "",
            prazo_padrao_dias: 1,
            ativo: true,
            ocorrencias_por_estado: { ...ZERADAS, aberta: 3, em_triagem: 1, encaminhada: 2 },
          },
          {
            id: "t-2",
            nome: "Poda",
            descricao: "",
            prazo_padrao_dias: null,
            ativo: true,
            ocorrencias_por_estado: {
              ...ZERADAS,
              em_atendimento: 4,
              concluida: 1200,
              cancelada: 2,
            },
          },
        ]),
      ),
    );
    const usuario = userEvent.setup();
    await abrir("/administracao/tipos-ocorrencia");
    expect(await screen.findByText("1 dia")).toBeInTheDocument();
    const legenda = screen.getByRole("list", { name: /Situações das ocorrências/ });
    expect(
      within(legenda)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "Aberta",
      "→Em triagem",
      "→Encaminhada",
      "→Em atendimento",
      "→Concluída",
      "→Cancelada",
    ]);

    // Contagem por situação, por tipo (triagem e encaminhada somadas).
    const cabecalhos = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalhos.slice(2, 7)).toEqual([
      "Abertas",
      "Em triagem ou encaminhadas",
      "Em atendimento",
      "Concluídas",
      "Canceladas",
    ]);
    const contagem = (nome: string) =>
      within(screen.getByText(nome).closest("tr")!)
        .getAllByRole("cell")
        .slice(2, 7)
        .map((td) => td.textContent);
    expect(contagem("Risco de queda")).toEqual(["3", "3", "0", "0", "0"]);
    expect(contagem("Poda")).toEqual(["0", "0", "4", "1.200", "2"]);

    const linha = screen.getByText("Poda").closest("tr")!;
    await usuario.click(within(linha).getByRole("button", { name: "Editar Poda" }));
    expect(await screen.findByRole("dialog", { name: /Editar Poda/ })).toBeInTheDocument();
  });
});
