import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@itree/api-client", () => ({
  territoriosGeojson: () => Promise.resolve({ data: { type: "FeatureCollection", features: [] } }),
  useMapaCamadas: () => ({ data: undefined }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("../../mapa/Mapa", () => ({
  Mapa: ({ className, rotulo }: { className?: string; rotulo: string }) => (
    <div role="region" aria-label={rotulo} className={className} />
  ),
}));

import { MapaResumo } from "./MapaResumo";

describe("mapa resumido da visão geral (R2-04)", () => {
  it("tem altura definida, para o mapa não sumir quando o pai só tem altura mínima", () => {
    render(<MapaResumo />);
    const mapa = screen.getByRole("region", { name: /Mapa resumido/ });
    // O MapLibre mede o contêiner: `min-h-*` com `flex-1` num pai sem altura dava 0 px.
    expect(mapa.className).toMatch(/(^|\s)h-\d+(\s|$)/);
    expect(mapa.className).not.toMatch(/min-h|flex-1/);
  });
});
