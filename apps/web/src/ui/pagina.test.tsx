import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AbasSecao, CabecalhoPagina, type Migalha } from "./pagina";

async function renderizar(migalhas?: Migalha[]) {
  const raiz = createRootRoute();
  const rota = createRoute({
    getParentRoute: () => raiz,
    path: "/",
    component: () => <CabecalhoPagina titulo="ARV-000058" migalhas={migalhas} />,
  });
  const roteador = createRouter({
    routeTree: raiz.addChildren([rota]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={roteador} />);
  await screen.findByRole("heading", { name: "ARV-000058" });
}

describe("CabecalhoPagina: migalhas", () => {
  it("mostra o caminho, com link nos níveis anteriores e a página atual marcada", async () => {
    await renderizar([
      { rotulo: "Inventário", para: "/inventario" },
      { rotulo: "Árvores", para: "/inventario/arvores" },
      { rotulo: "ARV-000058" },
    ]);
    const nav = screen.getByRole("navigation", { name: "Migalhas" });
    expect(nav).toHaveTextContent("Inventário›Árvores›ARV-000058");
    expect(screen.getByRole("link", { name: "Inventário" })).toHaveAttribute("href", "/inventario");
    expect(screen.getByRole("link", { name: "Árvores" })).toHaveAttribute(
      "href",
      "/inventario/arvores",
    );
    expect(screen.queryByRole("link", { name: "ARV-000058" })).not.toBeInTheDocument();
    expect(screen.getByText("ARV-000058", { selector: "span" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("não cria a navegação quando não há migalhas", async () => {
    await renderizar();
    expect(screen.queryByRole("navigation", { name: "Migalhas" })).not.toBeInTheDocument();
  });
});

async function renderizarEm(caminho: string, pagina: () => React.ReactNode) {
  const raiz = createRootRoute({ component: () => <>{pagina()}</> });
  const rotas = ["/", "/inv/arvores", "/inv/arvores/ARV-1"].map((path) =>
    createRoute({ getParentRoute: () => raiz, path, component: () => null }),
  );
  const roteador = createRouter({
    routeTree: raiz.addChildren(rotas),
    history: createMemoryHistory({ initialEntries: [caminho] }),
  });
  render(<RouterProvider router={roteador} />);
  await screen.findByRole("heading", { name: "Título" });
}

describe("CabecalhoPagina: padrão único (R3-03)", () => {
  it("põe abas, título e descrição à esquerda e as ações à direita, com a principal por último", async () => {
    await renderizarEm("/", () => (
      <CabecalhoPagina
        titulo="Título"
        descricao="Descrição"
        abas={<AbasSecao rotulo="Seções" abas={[{ para: "/inv/arvores", rotulo: "Árvores" }]} />}
        acoes={
          <>
            <button>Secundária</button>
            <button>Principal</button>
          </>
        }
      />
    ));
    const abas = screen.getByRole("navigation", { name: "Seções" });
    const titulo = screen.getByRole("heading", { name: "Título" });
    // As abas vêm antes do título no documento.
    expect(abas.compareDocumentPosition(titulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const acoes = screen.getByRole("button", { name: "Principal" }).parentElement!;
    expect(acoes).toHaveClass("ml-auto", "justify-end");
    expect(acoes.lastElementChild).toHaveTextContent("Principal");
    // A descrição fica junto do título, e não das ações.
    expect(titulo.parentElement).toHaveTextContent("Descrição");
    expect(acoes).not.toHaveTextContent("Descrição");
  });
});

describe("AbasSecao: rotas de detalhe (R3-04)", () => {
  const abas = [{ para: "/inv/arvores", rotulo: "Árvores" }];

  it("mostra as abas numa lista", async () => {
    await renderizarEm("/inv/arvores", () => (
      <>
        <AbasSecao rotulo="Seções" abas={abas} />
        <h1>Título</h1>
      </>
    ));
    expect(screen.getByRole("navigation", { name: "Seções" })).toBeInTheDocument();
  });

  it("esconde as abas num detalhe, onde a migalha já leva de volta", async () => {
    await renderizarEm("/inv/arvores/ARV-1", () => (
      <>
        <AbasSecao rotulo="Seções" abas={abas} />
        <h1>Título</h1>
      </>
    ));
    expect(screen.queryByRole("navigation", { name: "Seções" })).toBeNull();
  });
});
