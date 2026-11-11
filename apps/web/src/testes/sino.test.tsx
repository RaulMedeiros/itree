import {
  configurarCliente,
  type Eu,
  type GrupoNotificacoes,
  type Notificacao,
} from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { destinoDoLink } from "../util/filtros";
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

const API = "http://api.teste";

const USUARIO: Eu = {
  id: "u-1",
  nome: "Ana Admin",
  email: "ana@itree.teste",
  papeis: ["administrador"],
  permissoes: ["admin.configuracao"],
  territorios: [{ id: "t-for", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "producao",
};

const notificacao = (p: Partial<Notificacao>): Notificacao => ({
  id: "n-1",
  tipo: "alerta_novo",
  titulo: "1 novo alerta ambiental",
  texto: "",
  link: "/administracao/integracoes",
  lida: false,
  lida_em: null,
  criado_em: "2026-11-11T12:00:00Z",
  ...p,
});

const grupo = (p: Partial<GrupoNotificacoes>): GrupoNotificacoes => ({
  tipo: "alerta_novo",
  dia: "2026-11-11",
  quantidade: 1,
  nao_lidas: 1,
  lida: false,
  titulo: "1 novo alerta ambiental",
  texto: "",
  link: "/administracao/integracoes",
  ultima_em: "2026-11-11T12:00:00Z",
  ...p,
});

let notificacoes: Notificacao[] = [];
/** O que o servidor devolve já agrupado (mesmo tipo no mesmo dia) para o menu do sino. */
let grupos: GrupoNotificacoes[] = [];
const chamadas: string[] = [];
const consultasLista: URLSearchParams[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(USUARIO)),
  http.get(`${API}/api/v1/alertas/ingestoes`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/alertas/fontes`, () => HttpResponse.json([])),
  http.get(`${API}/api/v1/notificacoes/contagem`, () =>
    HttpResponse.json({ nao_lidas: notificacoes.filter((n) => !n.lida).length }),
  ),
  http.get(`${API}/api/v1/notificacoes/agrupadas`, () => HttpResponse.json(grupos)),
  http.post(`${API}/api/v1/notificacoes/ler-grupo`, async ({ request }) => {
    const corpo = (await request.json()) as { tipo: string; dia: string };
    chamadas.push(`ler-grupo:${corpo.tipo}:${corpo.dia}`);
    grupos = grupos.map((g) => (g.tipo === corpo.tipo ? { ...g, lida: true, nao_lidas: 0 } : g));
    notificacoes = notificacoes.map((n) => (n.tipo === corpo.tipo ? { ...n, lida: true } : n));
    return HttpResponse.json({ nao_lidas: 0 });
  }),
  http.get(`${API}/api/v1/notificacoes`, ({ request }) => {
    consultasLista.push(new URL(request.url).searchParams);
    return HttpResponse.json({
      count: notificacoes.length,
      next: null,
      previous: null,
      results: notificacoes,
    });
  }),
  http.post(`${API}/api/v1/notificacoes/ler-todas`, () => {
    chamadas.push("ler-todas");
    notificacoes = notificacoes.map((n) => ({ ...n, lida: true }));
    return HttpResponse.json({ nao_lidas: 0 });
  }),
  http.post(`${API}/api/v1/notificacoes/:id/ler`, ({ params }) => {
    chamadas.push(`ler:${String(params.id)}`);
    notificacoes = notificacoes.map((n) => (n.id === params.id ? { ...n, lida: true } : n));
    return HttpResponse.json(notificacoes.find((n) => n.id === params.id));
  }),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "token-teste" });
});
afterEach(() => {
  servidor.resetHandlers();
  notificacoes = [];
  grupos = [];
  chamadas.length = 0;
  consultasLista.length = 0;
});
afterAll(() => servidor.close());

async function abrir() {
  const { criarRoteador } = await import("../rotas");
  const roteador = criarRoteador(createMemoryHistory({ initialEntries: ["/"] }));
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <RouterProvider router={roteador} />
    </QueryClientProvider>,
  );
}

describe("sino de notificações (RF-SHELL-002)", () => {
  it("é um ícone neutro, sem contador, quando não há notificações não lidas", async () => {
    await abrir();
    const sino = await screen.findByRole("button", { name: "Notificações" });
    expect(sino).toHaveTextContent("");
  });

  it("mostra o contador de não lidas", async () => {
    notificacoes = [
      notificacao({ id: "a" }),
      notificacao({ id: "b" }),
      notificacao({ id: "c", lida: true }),
    ];
    await abrir();
    const sino = await screen.findByRole("button", { name: "Notificações: 2 não lidas" });
    expect(sino).toHaveTextContent("2");
  });

  it("marca o grupo como lido e abre o link ao escolher uma notificação", async () => {
    notificacoes = [notificacao({ id: "a" })];
    grupos = [grupo({})];
    await abrir();
    await userEvent.click(await screen.findByRole("button", { name: /Notificações: 1 não lida/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /1 novo alerta ambiental/ }));
    await waitFor(() => expect(chamadas).toEqual(["ler-grupo:alerta_novo:2026-11-11"]));
    expect(await screen.findByRole("heading", { name: "Integrações" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notificações" })).toBeInTheDocument(),
    );
  });

  it("mostra eventos do mesmo tipo no mesmo dia agrupados, e não um por evento", async () => {
    notificacoes = Array.from({ length: 5 }, (_, i) =>
      notificacao({ id: `n${i}`, tipo: "inspecao_para_revisao", titulo: `Inspeção INS-${i}` }),
    );
    grupos = [
      grupo({
        tipo: "inspecao_para_revisao",
        quantidade: 5,
        nao_lidas: 5,
        titulo: "5 inspeções aguardando revisão",
        link: "/inspecoes",
      }),
    ];
    await abrir();
    await userEvent.click(await screen.findByRole("button", { name: /Notificações: 5 não lidas/ }));
    const item = await screen.findByRole("menuitem", { name: /5 inspeções aguardando revisão/ });
    expect(screen.queryByText(/Inspeção INS-0/)).toBeNull();
    expect(screen.getAllByRole("menuitem").filter((m) => m !== item)).toHaveLength(1); // "Ver todas"
  });

  it("leva à central de notificações pelo link Ver todas", async () => {
    notificacoes = [notificacao({ id: "a", titulo: "Aviso na central" })];
    grupos = [grupo({})];
    await abrir();
    await userEvent.click(await screen.findByRole("button", { name: /Notificações: 1 não lida/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Ver todas" }));
    expect(await screen.findByRole("heading", { name: "Notificações" })).toBeInTheDocument();
    expect(await screen.findByText("Aviso na central")).toBeInTheDocument();
  });

  it("não chama a API de leitura para grupo já lido", async () => {
    grupos = [grupo({ titulo: "Aviso antigo", lida: true, nao_lidas: 0 })];
    notificacoes = [notificacao({ id: "b", titulo: "Aviso novo" })];
    await abrir();
    await userEvent.click(await screen.findByRole("button", { name: /Notificações/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Aviso antigo/ }));
    expect(await screen.findByRole("heading", { name: "Integrações" })).toBeInTheDocument();
    expect(chamadas).toEqual([]);
  });

  it("marca todas como lidas", async () => {
    notificacoes = [notificacao({ id: "a" }), notificacao({ id: "b" })];
    grupos = [
      grupo({ quantidade: 2, nao_lidas: 2, titulo: "2 avisos de alertas ambientais novos" }),
    ];
    await abrir();
    await userEvent.click(await screen.findByRole("button", { name: /Notificações: 2 não lidas/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Marcar todas como lidas" }));
    await waitFor(() => expect(chamadas).toEqual(["ler-todas"]));
    // O menu continua aberto (o resto da página fica oculto para leitores de tela).
    expect(
      await screen.findByRole("button", { name: "Notificações", hidden: true }),
    ).toBeInTheDocument();
  });

  it("informa quando não há nada novo", async () => {
    await abrir();
    await userEvent.click(await screen.findByRole("button", { name: "Notificações" }));
    expect(await screen.findByText("Nada novo por aqui.")).toBeInTheDocument();
  });
});

describe("central de notificações (G-09)", () => {
  async function abrirCentral(busca = "") {
    const { criarRoteador } = await import("../rotas");
    const roteador = criarRoteador(
      createMemoryHistory({ initialEntries: [`/notificacoes${busca}`] }),
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={roteador} />
      </QueryClientProvider>,
    );
  }

  it("lista uma linha por notificação, com o tipo, sem agrupar", async () => {
    notificacoes = [
      notificacao({
        id: "a",
        tipo: "inspecao_para_revisao",
        titulo: "Inspeção INS-1 aguardando revisão",
      }),
      notificacao({
        id: "b",
        tipo: "inspecao_para_revisao",
        titulo: "Inspeção INS-2 aguardando revisão",
      }),
    ];
    await abrirCentral();
    expect(await screen.findByText("Inspeção INS-1 aguardando revisão")).toBeInTheDocument();
    expect(screen.getByText("Inspeção INS-2 aguardando revisão")).toBeInTheDocument();
    expect(screen.getAllByText("Inspeção para revisão")).toHaveLength(3); // 2 selos + 1 opção do filtro
  });

  it("filtra por tipo e por lida, mandando os filtros ao servidor", async () => {
    notificacoes = [notificacao({ id: "a" })];
    await abrirCentral();
    await screen.findByText("1 novo alerta ambiental");
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "risco_confirmado");
    await userEvent.selectOptions(screen.getByLabelText("Situação"), "false");
    await waitFor(() => {
      const ultima = consultasLista.at(-1)!;
      expect(ultima.get("tipo")).toBe("risco_confirmado");
      expect(ultima.get("lida")).toBe("false");
    });
    expect(consultasLista[0]!.get("tipo")).toBeNull();
    expect(consultasLista[0]!.get("lida")).toBeNull();
  });

  it("lê os filtros da URL e oferece limpar quando nada corresponde", async () => {
    await abrirCentral("?tipo=tarefa_bloqueada&lida=true");
    expect(
      await screen.findByText("Nenhum resultado para os filtros escolhidos"),
    ).toBeInTheDocument();
    expect(consultasLista[0]!.get("tipo")).toBe("tarefa_bloqueada");
    expect(consultasLista[0]!.get("lida")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(await screen.findByText("Nada novo por aqui")).toBeInTheDocument();
  });

  it("marca como lida ao abrir a notificação", async () => {
    notificacoes = [notificacao({ id: "a" })];
    await abrirCentral();
    await userEvent.click(await screen.findByRole("button", { name: /1 novo alerta ambiental/ }));
    await waitFor(() => expect(chamadas).toEqual(["ler:a"]));
    expect(await screen.findByRole("heading", { name: "Integrações" })).toBeInTheDocument();
  });
});

describe("destinoDoLink", () => {
  it("separa o caminho dos parâmetros", () => {
    expect(destinoDoLink("/equipes-tarefas?responsavel=eu")).toEqual({
      to: "/equipes-tarefas",
      search: { responsavel: "eu" },
    });
    expect(destinoDoLink("/alertas")).toEqual({ to: "/alertas", search: {} });
  });
});
