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

  it("no celular a barra de decisão fica fixa no rodapé, com botões que dividem a largura", async () => {
    await abrir("/inspecoes/i-1");
    const barra = await screen.findByRole("region", { name: "Decisão da revisão" });
    expect(barra).toHaveClass("sticky", "bottom-0", "-mx-4", "px-4");
    expect(barra.className).toContain("[&>button]:max-md:flex-1");
    // Os botões quebram em duas linhas no celular: a reserva é maior.
    expect(barra.previousElementSibling).toHaveClass("max-md:h-32");
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

  it("os campos De e até mostram o período aplicado e há atalhos (R3-13)", async () => {
    await abrir("/analises");
    await screen.findByText("Total");
    // O texto diz "Período: 10/11/2025 a 10/11/2026"; os campos dizem a mesma coisa.
    expect(screen.getAllByDisplayValue(/^\d{2}\/\d{2}\/\d{4}$/)).toHaveLength(2);
    expect(screen.getByDisplayValue("10/11/2025")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10/11/2026")).toBeInTheDocument();
    const atalhos = screen.getByRole("group", { name: "Atalhos de período" });
    for (const rotulo of ["30 dias", "12 meses", "Ano"])
      expect(within(atalhos).getByRole("button", { name: rotulo })).toBeInTheDocument();
  });

  it("por bairro, os cabeçalhos dizem Bairro e Árvores, e os bairros sem árvores ficam recolhidos (R3-14)", async () => {
    servidor.use(
      http.get(`${API}/api/v1/relatorios/analise`, () =>
        HttpResponse.json({
          id: "arvores_por_bairro",
          titulo: "Árvores com registro válido por bairro",
          definicao: "d",
          fonte: "Registros da plataforma",
          periodo: { inicio: "2025-11-10", fim: "2026-11-10" },
          calculado_em: "2026-11-10T12:00:00Z",
          por_bairro: true,
          unidade: "",
          base_rotulo: "",
          linhas: [
            { rotulo: "Meireles", valor: 88 },
            { rotulo: "Aldeota", valor: 0 },
            { rotulo: "Cocó", valor: 0 },
          ],
          total: 88,
        }),
      ),
    );
    await abrir("/analises");
    expect(await screen.findByRole("columnheader", { name: "Bairro" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Árvores" })).toBeInTheDocument();
    const grupo = screen.getByText("Sem árvores no escopo (2)").closest("details")!;
    expect(grupo).not.toHaveAttribute("open");
    expect(within(grupo).getByText("Aldeota")).toBeInTheDocument();
    // Fora do grupo, a tabela só traz o bairro com árvores.
    expect(within(screen.getByRole("table")).queryByText("Aldeota")).toBeNull();
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

  it("mostra as mudas doadas por espécie em barras, com o restante em Outras, a fonte e o ano", async () => {
    servidor.use(
      http.get(`${API}/api/v1/relatorios/analise`, () =>
        HttpResponse.json({
          id: "mudas_doadas_por_especie",
          titulo: "Mudas doadas por espécie (URBFOR, 2022)",
          definicao:
            "Mudas doadas pela URBFOR em 2022. Ressalvas: (1) a planilha não tem local de plantio, então o dado não vai ao mapa.",
          fonte:
            "URBFOR (Autarquia de Urbanismo e Paisagismo de Fortaleza), dados abertos de Fortaleza (https://dados.fortaleza.ce.gov.br/dataset/doacao-mudas-pf); planilhas de 2022. Licença: Creative Commons Atribuição-CompartilhaIgual (cc-by-sa), declarada no CKAN.",
          periodo: { inicio: "2025-11-10", fim: "2026-11-10" },
          calculado_em: "2026-11-10T12:00:00Z",
          por_bairro: false,
          unidade: "",
          base_rotulo: "mudas",
          linhas: [
            {
              rotulo: "Mini lacre",
              valor: 4542,
              detalhe: "Ornamental · pessoa física 529 · pessoa jurídica 4.013",
            },
            { rotulo: "Vinca", valor: 2154, detalhe: "Ornamental · pessoa jurídica 2.096" },
            { rotulo: "Outras (199 espécies)", valor: 8448, detalhe: "" },
          ],
          total: 15144,
        }),
      ),
    );
    await abrir("/analises");
    expect(
      await screen.findByRole("heading", { name: "Mudas doadas por espécie (URBFOR, 2022)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Mudas doadas" })).toBeInTheDocument();
    expect(screen.getByText("Mini lacre")).toBeInTheDocument();
    expect(
      screen.getByText("Ornamental · pessoa física 529 · pessoa jurídica 4.013"),
    ).toBeInTheDocument();
    expect(screen.getByText("Outras (199 espécies)")).toBeInTheDocument();
    expect(screen.getByText(/planilhas de 2022/)).toBeInTheDocument();
    expect(screen.getByText(/cc-by-sa/)).toBeInTheDocument();
    expect(screen.getByText(/não vai ao mapa/)).toBeInTheDocument();
    expect(screen.getByText("15.144")).toBeInTheDocument();
  });

  it("mostra os plantios por bairro e declara a parcela sem bairro identificado", async () => {
    servidor.use(
      http.get(`${API}/api/v1/relatorios/analise`, () =>
        HttpResponse.json({
          id: "plantios_por_bairro",
          titulo: "Plantios por bairro (URBFOR, 2022)",
          definicao:
            "Mudas plantadas pela URBFOR em 2022, somadas por bairro. Ressalvas: (1) a planilha é um relatório em fichas, sem coordenadas.",
          fonte: "URBFOR, planilhas de 2022. Licença: cc-by-sa.",
          periodo: { inicio: "2025-11-10", fim: "2026-11-10" },
          calculado_em: "2026-11-10T12:00:00Z",
          por_bairro: true,
          unidade: "",
          base_rotulo: "mudas",
          linhas: [
            { rotulo: "Floresta", valor: 869, detalhe: "1 plantio(s)", territorio_id: "t1" },
            {
              rotulo: "Sem bairro identificado",
              valor: 17000,
              detalhe: "39 plantio(s) · Sem endereço (só o local) 24",
              territorio_id: null,
            },
          ],
          total: 17869,
        }),
      ),
    );
    await abrir("/analises");
    expect(
      await screen.findByRole("heading", { name: "Plantios por bairro (URBFOR, 2022)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Mudas plantadas" })).toBeInTheDocument();
    expect(screen.getByText("Floresta")).toBeInTheDocument();
    expect(screen.getByText("Sem bairro identificado")).toBeInTheDocument();
    expect(screen.getByText("39 plantio(s) · Sem endereço (só o local) 24")).toBeInTheDocument();
    expect(screen.getByText("17.869")).toBeInTheDocument();
  });

  it("o manejo da URBFOR tem dois gráficos e marca setembro como sem dado na fonte (F-06)", async () => {
    const meses = Array.from({ length: 12 }, (_, i) => `2023-${String(i + 1).padStart(2, "0")}`);
    const comSetembro = (valores: number[]) => valores.map((v, i) => (i === 8 ? null : v));
    servidor.use(
      http.get(`${API}/api/v1/relatorios/analise`, () =>
        HttpResponse.json({
          id: "manejo_urbfor_por_bairro",
          titulo: "Manejo registrado pela URBFOR (2023)",
          definicao: "d",
          fonte: "URBFOR",
          periodo: { inicio: "2025-11-10", fim: "2026-11-10" },
          calculado_em: "2026-11-10T12:00:00Z",
          por_bairro: true,
          unidade: "",
          base_rotulo: "árvores",
          linhas: [{ rotulo: "Aldeota", valor: 298 }],
          total: 298,
          serie_mensal: {
            meses,
            sem_dado: ["2023-09"],
            series: [
              {
                id: "poda",
                rotulo: "Poda",
                valores: comSetembro([
                  1032, 1500, 1200, 1100, 1900, 1800, 2375, 1964, 0, 953, 1316, 1568,
                ]),
              },
              {
                id: "supressao",
                rotulo: "Supressão",
                valores: comSetembro([82, 100, 90, 70, 150, 120, 159, 180, 0, 79, 80, 194]),
              },
              {
                id: "recolhimento",
                rotulo: "Recolhimento",
                valores: comSetembro([119, 40, 30, 20, 60, 50, 37, 25, 0, 60, 41, 54]),
              },
            ],
            grupos: [
              { titulo: "Podas por mês", series: ["poda"] },
              { titulo: "Supressão e recolhimento por mês", series: ["supressao", "recolhimento"] },
            ],
          },
        }),
      ),
    );
    const usuario = userEvent.setup();
    await abrir("/analises");
    expect(await screen.findByRole("heading", { name: "Podas por mês" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Supressão e recolhimento por mês" }),
    ).toBeInTheDocument();
    // Dois gráficos, no máximo duas séries em cada (paleta de duas cores).
    const graficos = screen.getAllByRole("img", { name: /Evolução mensal/ });
    expect(graficos).toHaveLength(2);
    expect(graficos[0]).toHaveAccessibleName(/Poda, de jan\/23 a dez\/23/);
    expect(graficos[1]).toHaveAccessibleName(/Supressão e Recolhimento/);
    // Setembro marcado nos dois gráficos, e a linha não passa por zero nesse mês.
    expect(screen.getAllByTestId("sem-dado-2023-09")).toHaveLength(2);
    expect(screen.getAllByText("na fonte")).toHaveLength(2);
    expect(screen.getAllByLabelText("set/23: sem dado na fonte")).toHaveLength(2);
    expect(screen.queryByLabelText(/set\/23: Poda 0/)).toBeNull();
    // Tabela equivalente diz "sem dado na fonte" em vez de zero.
    await usuario.click(screen.getAllByRole("button", { name: "Ver em tabela" })[0]!);
    const linhaSet = screen.getByRole("cell", { name: "set/23" }).closest("tr")!;
    expect(within(linhaSet).getByText("sem dado na fonte")).toBeInTheDocument();
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

describe("análises: população, árvores por 1.000 habitantes e renda", () => {
  const POR_MIL = {
    id: "arvores_por_mil_habitantes_por_bairro",
    titulo: "Árvores por 1.000 habitantes por bairro (provisório)",
    definicao: "Árvores cadastradas para cada 1.000 habitantes do bairro, pela população do Censo.",
    fonte: "IBGE, Censo Demográfico 2022 (população) e inventário do iTree",
    periodo: { inicio: "2025-11-10", fim: "2026-11-10" },
    calculado_em: "2026-11-10T12:00:00Z",
    por_bairro: true,
    unidade: "",
    base_rotulo: "habitantes",
    total: null,
    provisorio: true,
    ordenavel: true,
    ressalvas: [
      "Conta só as árvores cadastradas; enquanto o inventário não cobre o bairro, um valor baixo pode indicar falta de cadastro, não falta de árvores.",
      "Valor provisório: a fórmula oficial dos indicadores ainda depende de decisão da prefeitura (DP-14). Não é índice oficial.",
    ],
    colunas_csv: [
      { chave: "rotulo", rotulo: "Bairro" },
      { chave: "valor", rotulo: "Árvores cadastradas por 1.000 habitantes" },
      { chave: "arvores", rotulo: "Árvores cadastradas" },
    ],
    linhas: [
      { rotulo: "Aldeota", valor: 0.5, arvores: 20, territorio_id: "b-1", detalhe: "20 árvores" },
      { rotulo: "Messejana", valor: 0.1, arvores: 4, territorio_id: "b-2", detalhe: "4 árvores" },
      { rotulo: "Centro", valor: 1.2, arvores: 29, territorio_id: "b-3", detalhe: "29 árvores" },
    ],
    serie_mensal: null,
    dispersao: null,
  };

  const servir = (corpo: object) =>
    servidor.use(
      http.get(`${API}/api/v1/relatorios/catalogo`, () =>
        HttpResponse.json({
          analises: [{ id: (corpo as { id: string }).id, titulo: "x", definicao: "d" }],
        }),
      ),
      http.get(`${API}/api/v1/relatorios/analise`, () => HttpResponse.json(corpo)),
    );

  it("mostra o selo provisório, as ressalvas e ordena a tabela", async () => {
    servir(POR_MIL);
    const usuario = userEvent.setup();
    await abrir("/analises");
    expect(await screen.findByText("Provisório")).toBeInTheDocument();
    const ressalvas = screen.getByRole("list", { name: "Ressalvas" });
    expect(within(ressalvas).getByText(/pode indicar falta de cadastro/)).toBeInTheDocument();
    expect(within(ressalvas).getByText(/Não é índice oficial/)).toBeInTheDocument();
    const ordem = () =>
      screen.getAllByRole("link", { name: /Aldeota|Messejana|Centro/ }).map((a) => a.textContent);
    expect(ordem()).toEqual(["Centro", "Aldeota", "Messejana"]);
    await usuario.selectOptions(
      screen.getByRole("combobox", { name: "Ordenar a tabela" }),
      "menor",
    );
    expect(ordem()).toEqual(["Messejana", "Aldeota", "Centro"]);
    await usuario.selectOptions(screen.getByRole("combobox", { name: "Ordenar a tabela" }), "nome");
    expect(ordem()).toEqual(["Aldeota", "Centro", "Messejana"]);
  });

  it("baixa o CSV na ordem da tela, com as colunas e a ressalva", async () => {
    servir(POR_MIL);
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:csv";
    });
    URL.revokeObjectURL = vi.fn();
    const usuario = userEvent.setup();
    await abrir("/analises");
    await usuario.click(await screen.findByRole("button", { name: /Baixar CSV/ }));
    expect(blobs).toHaveLength(1);
    const texto = await blobs[0]!.text();
    expect(texto).toContain("# ressalva: Conta só as árvores cadastradas");
    expect(texto).toContain("Bairro;Árvores cadastradas por 1.000 habitantes;Árvores cadastradas");
    expect(texto.indexOf("Centro;1,2;29")).toBeLessThan(texto.indexOf("Aldeota;0,5;20"));
  });

  it("a dispersão por renda mostra os pontos, a correlação só como descrição e a tabela", async () => {
    servir({
      ...POR_MIL,
      id: "arvores_mil_x_renda",
      titulo: "Árvores por 1.000 habitantes × rendimento do responsável, por bairro",
      colunas_csv: [{ chave: "rotulo", rotulo: "Bairro" }],
      dispersao: {
        x_rotulo: "Rendimento médio do responsável (R$, Censo 2022)",
        y_rotulo: "Árvores cadastradas por 1.000 habitantes (provisório)",
        pontos: [
          { id: "b-1", rotulo: "Aldeota", x: 10572, y: 0.5, populacao: 42580, arvores: 20 },
          { id: "b-2", rotulo: "Messejana", x: 2854, y: 0.1, populacao: 43205, arvores: 4 },
          { id: "b-3", rotulo: "Centro", x: 4192, y: 1.2, populacao: 24096, arvores: 29 },
        ],
        correlacao: {
          r: 0.12,
          bairros: 3,
          metodo: "É só uma descrição dos dados: não mede causa, não é índice oficial.",
        },
      },
    });
    await abrir("/analises");
    const figura = await screen.findByTestId("dispersao");
    expect(within(figura).getByRole("img", { name: /Dispersão de 3 bairros/ })).toBeInTheDocument();
    expect(within(figura).getAllByText(/árvores por 1\.000 hab\./).length).toBeGreaterThan(0);
    expect(
      within(figura).getByText(/Descrição, não afirmação de causa: r = 0,12 entre 3 bairros/),
    ).toBeInTheDocument();
    expect(within(figura).getByText(/não mede causa/)).toBeInTheDocument();
    // A tabela com os mesmos bairros acompanha o gráfico.
    expect(screen.getByRole("link", { name: "Aldeota" })).toHaveAttribute("href", "/bairros/b-1");
  });
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
    entidade_modelo: "contas.Usuario",
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

describe("R3-31: espera na fila de revisão", () => {
  it("chegar hoje ou ontem é texto suave; só a espera de 3 dias ou mais ganha a cor de atenção", async () => {
    const haDias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    servidor.use(
      http.get(`${API}/api/v1/inspecoes`, () =>
        HttpResponse.json(
          pagina([
            { ...inspecao("i-1", "INS-000001", []), recebida_em: haDias(0) },
            { ...inspecao("i-2", "INS-000002", []), recebida_em: haDias(1) },
            { ...inspecao("i-3", "INS-000003", []), recebida_em: haDias(5) },
          ]),
        ),
      ),
    );
    await abrir("/inspecoes");
    await screen.findByText("INS-000001");
    expect(screen.getByText("chegou hoje")).toHaveClass("text-texto-suave");
    expect(screen.getByText("aguarda há 1 dia")).toHaveClass("text-texto-suave");
    expect(screen.getByText("aguarda há 5 dias")).toHaveClass("text-atencao");
  });
});
