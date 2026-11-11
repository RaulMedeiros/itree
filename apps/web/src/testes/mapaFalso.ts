import { vi } from "vitest";

/**
 * Mapa falso para os testes da tela do mapa: o MapLibre precisa de WebGL, ausente
 * no jsdom. Guarda fontes e camadas e permite disparar eventos como o mapa real.
 */
type Manipulador = (e: unknown) => void;

export class MapaFalso {
  fontes = new Map<string, { data: unknown }>();
  camadas: { id: string; type: string; source?: string; antesDe?: string }[] = [];
  manipuladores: { evento: string; camada?: string; fn: Manipulador }[] = [];
  dragPan = { enable: vi.fn(), disable: vi.fn() };
  doubleClickZoom = { enable: vi.fn(), disable: vi.fn() };
  canvas = document.createElement("canvas");
  fitBounds = vi.fn();
  easeTo = vi.fn();
  zoom = 12;

  addSource(id: string, fonte: { data?: unknown }) {
    this.fontes.set(id, { data: fonte.data });
  }
  getSource(id: string) {
    const fonte = this.fontes.get(id);
    if (!fonte) return undefined;
    return {
      setData: (dados: unknown) => void (fonte.data = dados),
      setTiles: vi.fn(),
    };
  }
  addLayer(camada: { id: string; type: string; source?: string }, antesDe?: string) {
    this.camadas.push({ ...camada, antesDe });
  }
  getLayer(id: string) {
    return this.camadas.find((c) => c.id === id);
  }
  /** Feições renderizadas sob o ponto; os testes preenchem quando querem um clique em árvore. */
  renderizadas: unknown[] = [];
  queryRenderedFeatures = vi.fn(() => this.renderizadas);
  setFilter = vi.fn();
  setPaintProperty = vi.fn();
  setLayoutProperty = vi.fn();
  addImage = vi.fn();
  hasImage = () => true;
  getCanvas() {
    return this.canvas;
  }
  getZoom() {
    return this.zoom;
  }
  getCenter() {
    return { lng: -38.5, lat: -3.7 };
  }
  getBounds() {
    return {
      getWest: () => -38.6,
      getSouth: () => -3.8,
      getEast: () => -38.4,
      getNorth: () => -3.6,
    };
  }
  getStyle() {
    return { layers: [] };
  }
  on(evento: string, camadaOuFn: string | Manipulador, fn?: Manipulador) {
    if (typeof camadaOuFn === "string")
      this.manipuladores.push({ evento, camada: camadaOuFn, fn: fn! });
    else this.manipuladores.push({ evento, fn: camadaOuFn });
  }
  off(evento: string, camadaOuFn: string | Manipulador, fn?: Manipulador) {
    const alvo = typeof camadaOuFn === "string" ? fn : camadaOuFn;
    this.manipuladores = this.manipuladores.filter((m) => !(m.evento === evento && m.fn === alvo));
  }
  /** Dispara o evento nos manipuladores do mapa (ou da camada, quando informada). */
  emitir(evento: string, e: unknown = {}, camada?: string) {
    for (const m of [...this.manipuladores])
      if (m.evento === evento && m.camada === camada) m.fn(e);
  }
  dadosDe(id: string) {
    return this.fontes.get(id)?.data as { features: { properties: Record<string, unknown> }[] };
  }
}

export const mapasCriados: MapaFalso[] = [];
