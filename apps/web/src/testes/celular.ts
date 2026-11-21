import { afterEach, vi } from "vitest";

/**
 * O jsdom não tem `matchMedia`. Isto o simula: com `celular`, as consultas `max-width` valem
 * (abaixo de `md`); sem ele, nenhuma vale (desktop). Desfaz sozinho ao fim de cada teste.
 */
export function simularCelular(celular = true) {
  window.matchMedia = vi.fn((consulta: string) => ({
    matches: celular && consulta.includes("max-width"),
    media: consulta,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  // @ts-expect-error: volta ao jsdom puro, sem matchMedia.
  delete window.matchMedia;
});
