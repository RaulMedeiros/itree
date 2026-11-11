import { configurarCliente, type Eu, type Ingestao } from "@itree/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { EntradaArquivo, EntradaData } from "../ui/campos";
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

const servidor = setupServer(
  http.get(`${API}/api/v1/eu`, () => HttpResponse.json(eu)),
  http.get(`${API}/api/v1/alertas/ingestoes`, () => HttpResponse.json(ingestoes)),
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

  it("a tecla / leva o foco para a busca global", async () => {
    await abrir("/administracao/integracoes");
    const busca = await screen.findByRole("combobox", { name: "Busca global" });
    await userEvent.keyboard("/");
    expect(busca).toHaveFocus();
  });
});
