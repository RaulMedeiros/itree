import { configurarCliente, type Eu, type Ingestao } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { criarServidor } from "./servidorPadrao";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Campo, EntradaArquivo, EntradaData } from "../ui/campos";
import { fontesComProblema } from "../layout/fontes";
import { dataBrParaIso, mascararDataBr, plural } from "../util/formatos";

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
  permissoes: ["alertas.ler", "admin.configuracao"],
  territorios: [{ id: "t-for", nome: "Fortaleza", tipo: "municipio" }],
  ambiente: "demonstracao",
};

const ingestao = (p: Partial<Ingestao>): Ingestao =>
  ({
    id: 1,
    fonte: "inpe_focos",
    origem: "https://fonte.teste",
    iniciada_em: "2026-11-10T10:00:00Z",
    concluida_em: null,
    sucesso: true,
    recebidos: 0,
    novos: 0,
    ja_existentes: 0,
    fora_do_municipio: 0,
    invalidos: 0,
    erro: "",
    usuario: null,
    ...p,
  }) as Ingestao;

let eu: Eu = USUARIO;
let ingestoes: Ingestao[] = [];

const servidor = criarServidor(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/alertas/ingestoes`, () => HttpResponse.json(ingestoes)),
  http.get(`${API}/api/v1/alertas/fontes`, () => HttpResponse.json([])),
);

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
  configurarCliente({ urlBase: API, origem: "web", obterToken: () => "token-teste" });
});
afterEach(() => {
  servidor.resetHandlers();
  eu = USUARIO;
  ingestoes = [];
});
afterAll(() => servidor.close());

async function abrir(caminho: string) {
  const { criarRoteador } = await import("../rotas");
  const roteador = criarRoteador(createMemoryHistory({ initialEntries: [caminho] }));
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <RouterProvider router={roteador} />
    </QueryClientProvider>,
  );
  return roteador;
}

describe("formatos em português", () => {
  it("concorda o plural", () => {
    expect(plural(1, "dia")).toBe("1 dia");
    expect(plural(0, "dia")).toBe("0 dias");
    expect(plural(3, "árvore")).toBe("3 árvores");
    expect(plural(2, "sinal observado", "sinais observados")).toBe("2 sinais observados");
  });

  it("converte e mascara datas dd/mm/aaaa", () => {
    expect(mascararDataBr("1203202")).toBe("12/03/202");
    expect(dataBrParaIso("12/03/2026")).toBe("2026-03-12");
    expect(dataBrParaIso("31/02/2026")).toBe("");
    expect(dataBrParaIso("12/03/26")).toBe("");
  });
});

describe("EntradaData", () => {
  function Exemplo() {
    const [v, setV] = useState("");
    return (
      <>
        <label>
          Data
          <EntradaData value={v} onChange={setV} />
        </label>
        <output>{v}</output>
      </>
    );
  }

  it("mostra dd/mm/aaaa e entrega a data em ISO", async () => {
    render(<Exemplo />);
    const campo = screen.getByLabelText("Data");
    expect(campo).toHaveAttribute("placeholder", "dd/mm/aaaa");
    await userEvent.type(campo, "05112026");
    expect(campo).toHaveValue("05/11/2026");
    expect(screen.getByRole("status")).toHaveTextContent("2026-11-05");
  });

  it("não entrega data incompleta e marca data inexistente como inválida", async () => {
    render(<Exemplo />);
    const campo = screen.getByLabelText("Data");
    await userEvent.type(campo, "0511");
    expect(screen.getByRole("status")).toHaveTextContent("");
    await userEvent.clear(campo);
    await userEvent.type(campo, "31022026");
    expect(campo).toHaveAttribute("aria-invalid", "true");
  });

  it("descreve a data impossível em texto, ligada ao campo, e mostra o formato como dica", async () => {
    function ComCampo() {
      const [v, setV] = useState("");
      return (
        <Campo rotulo="Prazo" data>
          {(p) => <EntradaData {...p} value={v} onChange={setV} />}
        </Campo>
      );
    }
    render(<ComCampo />);
    const campo = screen.getByLabelText("Prazo");
    expect(campo).toHaveAccessibleDescription("Use o formato dd/mm/aaaa.");
    await userEvent.type(campo, "31022026");
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Data inválida. Use dd/mm/aaaa.")).toBeInTheDocument();
    expect(campo).toHaveAccessibleDescription(
      "Use o formato dd/mm/aaaa. Data inválida. Use dd/mm/aaaa.",
    );
    await userEvent.clear(campo);
    await userEvent.type(campo, "28022026");
    expect(screen.queryByText("Data inválida. Use dd/mm/aaaa.")).toBeNull();
  });

  it("não usa a dica de formato quando o Campo já tem ajuda própria", () => {
    render(
      <Campo rotulo="Prazo" data ajuda="Vazio usa o padrão.">
        {(p) => <EntradaData {...p} value="" onChange={() => {}} />}
      </Campo>,
    );
    expect(screen.getByLabelText("Prazo")).toHaveAccessibleDescription("Vazio usa o padrão.");
  });
});

describe("EntradaArquivo", () => {
  it("usa botão e textos em português e informa o arquivo escolhido", async () => {
    const aoMudar = vi.fn();
    render(<EntradaArquivo aria-label="Arquivo" accept=".csv" onChange={aoMudar} />);
    expect(screen.getByRole("button", { name: "Escolher arquivo" })).toBeInTheDocument();
    expect(screen.getByText("Nenhum arquivo escolhido")).toBeInTheDocument();
    const arquivo = new File(["a,b"], "inventario.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Arquivo"), { target: { files: [arquivo] } });
    expect(aoMudar).toHaveBeenCalledWith(arquivo);
    expect(screen.getByText("inventario.csv")).toBeInTheDocument();
  });

  it("liga rótulo, obrigatoriedade, ajuda e erros do Campo ao botão que recebe o foco", () => {
    render(
      <Campo rotulo="Arquivo (.csv)" obrigatorio ajuda="Até 5 MB." erros={["Arquivo ilegível."]}>
        {(p) => <EntradaArquivo {...p} accept=".csv" onChange={() => {}} />}
      </Campo>,
    );
    const botao = screen.getByRole("button", { name: /Arquivo \(\.csv\).*Escolher arquivo/ });
    expect(botao).toHaveAccessibleName("Arquivo (.csv)* Escolher arquivo");
    expect(botao).toHaveAccessibleDescription("Até 5 MB. Arquivo ilegível.");
    expect(botao).toHaveAttribute("aria-invalid", "true");
  });
});

describe("fontes externas (RF-SHELL-006)", () => {
  const agora = new Date("2026-11-11T12:00:00Z");

  it("aponta fonte com falha na última execução e fonte desatualizada", () => {
    const problemas = fontesComProblema(
      [
        ingestao({
          id: 3,
          fonte: "inpe_focos",
          sucesso: false,
          iniciada_em: "2026-11-11T08:00:00Z",
        }),
        ingestao({
          id: 2,
          fonte: "inpe_focos",
          sucesso: true,
          iniciada_em: "2026-11-10T08:00:00Z",
        }),
        ingestao({
          id: 1,
          fonte: "inpe_deter",
          sucesso: true,
          iniciada_em: "2026-11-01T08:00:00Z",
        }),
      ],
      agora,
    );
    expect(problemas.map((p) => p.motivo)).toEqual(["indisponivel", "desatualizada"]);
  });

  it("não aponta fonte recente e com sucesso", () => {
    expect(fontesComProblema([ingestao({ iniciada_em: "2026-11-11T06:00:00Z" })], agora)).toEqual(
      [],
    );
  });
});

describe("cabeçalho", () => {
  it("exibe a faixa de demonstração e o aviso de fonte com falha", async () => {
    ingestoes = [
      ingestao({ sucesso: false, erro: "timeout", iniciada_em: new Date().toISOString() }),
    ];
    await abrir("/administracao/integracoes");
    expect(
      await screen.findByText("Dados de demonstração — não representam a realidade."),
    ).toBeInTheDocument();
    const aviso = await screen.findByRole("link", { name: /1 fonte externa com problema/ });
    expect(aviso).toHaveAttribute("href", "/administracao/integracoes");
  });

  it("não exibe a faixa fora da demonstração nem aviso sem problema", async () => {
    eu = { ...USUARIO, ambiente: "producao" };
    ingestoes = [ingestao({ iniciada_em: new Date().toISOString() })];
    await abrir("/administracao/integracoes");
    expect(await screen.findByText("Ana Admin")).toBeInTheDocument();
    expect(screen.queryByText(/Dados de demonstração/)).not.toBeInTheDocument();
    expect(screen.queryByText(/fonte externa com problema/)).not.toBeInTheDocument();
  });

  it("não repete a migalha numa lista com aba ativa (R2-01)", async () => {
    await abrir("/administracao/integracoes");
    expect(
      await screen.findByRole("heading", { name: "Integrações", level: 1 }),
    ).toBeInTheDocument();
    // A aba ativa e o título já dizem onde a pessoa está.
    expect(screen.getByRole("link", { name: "Integrações" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("navigation", { name: "Migalhas" })).toBeNull();
  });

  it("limita o shell à altura da janela, com a faixa de demonstração (R3-01)", async () => {
    await abrir("/administracao/integracoes");
    const faixa = await screen.findByRole("note");
    const shell = screen.getByTestId("shell");
    // O contêiner tem a altura da janela e não cresce com o conteúdo.
    expect(shell).toHaveClass("h-dvh", "overflow-hidden", "flex-col");
    // A faixa mantém a altura própria; a área de conteúdo ocupa o restante e rola por dentro.
    expect(faixa).toHaveClass("shrink-0");
    const principal = screen.getByRole("main");
    expect(principal).toHaveClass("min-h-0", "flex-1", "overflow-auto");
    expect(principal.parentElement).toHaveClass("min-h-0");
  });

  it("limita o shell à altura da janela também sem a faixa (R3-01)", async () => {
    eu = { ...USUARIO, ambiente: "producao" };
    await abrir("/administracao/integracoes");
    await screen.findByText("Ana Admin");
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByTestId("shell")).toHaveClass("h-dvh", "overflow-hidden");
    expect(screen.getByRole("main")).toHaveClass("min-h-0", "flex-1", "overflow-auto");
  });

  it("volta a área de conteúdo ao topo ao trocar de página (R3-01)", async () => {
    const roteador = await abrir("/administracao/integracoes");
    await screen.findByText("Ana Admin");
    const principal = screen.getByRole("main");
    const rolar = vi.fn();
    principal.scrollTo = rolar as unknown as typeof principal.scrollTo;
    await roteador.navigate({ to: "/alertas" });
    await vi.waitFor(() => expect(rolar).toHaveBeenCalledWith({ top: 0 }));
  });

  it("marca Ocorrências como ativo na lista de alertas ambientais (R3-02)", async () => {
    await abrir("/alertas");
    const nav = await screen.findByRole("navigation", { name: "Navegação principal" });
    expect(await within(nav).findByRole("link", { name: /Ocorrências/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("a busca fica numa coluna central fixa do cabeçalho (R3-33)", async () => {
    await abrir("/administracao/integracoes");
    const busca = await screen.findByRole("combobox", { name: "Busca global" });
    const cabecalho = screen.getByTestId("shell").querySelector("header")!;
    expect(cabecalho).toHaveClass("grid-cols-[1fr_auto_1fr]");
    expect(busca.closest("header")).toBe(cabecalho);
  });

  it("a tecla / leva o foco para a busca global", async () => {
    await abrir("/administracao/integracoes");
    const busca = await screen.findByRole("combobox", { name: "Busca global" });
    await userEvent.keyboard("/");
    expect(busca).toHaveFocus();
  });
});
