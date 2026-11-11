import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CabecalhoPagina, type Migalha } from "./pagina";

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
