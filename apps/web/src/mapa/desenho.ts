/**
 * Desenho da área de seleção (RF-MAPA-022) com camadas GeoJSON do próprio
 * MapLibre, sem biblioteca de desenho.
 *
 * - Retângulo: arrastar no mapa.
 * - Polígono: um clique por vértice; duplo clique ou Enter fecha; Backspace
 *   desfaz o último vértice.
 * - Esc cancela. A área concluída fica com contorno tracejado enquanto o painel
 *   da seleção está aberto.
 */
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";

import { COR_SELECAO } from "./simbologia";

export type FormaArea = "retangulo" | "poligono";
export type Ponto = [number, number];

export interface PoligonoGeoJson {
  type: "Polygon";
  coordinates: Ponto[][];
}

export const FONTE_AREA = "area-selecao";
export const FONTE_RASCUNHO = "area-rascunho";

/** Menor arrasto (em pixels) que conta como retângulo, para um clique solto não virar área. */
const ARRASTO_MINIMO_PX = 4;
/** Cliques mais próximos que isto (px) do último vértice são o mesmo vértice (duplo clique). */
const VERTICE_REPETIDO_PX = 4;

const VAZIO = { type: "FeatureCollection", features: [] } as const;

const fechar = (anel: Ponto[]): Ponto[] => [...anel, anel[0]!];

export function poligonoDeCantos(a: Ponto, b: Ponto): PoligonoGeoJson {
  return {
    type: "Polygon",
    coordinates: [fechar([a, [b[0], a[1]], b, [a[0], b[1]]])],
  };
}

/** Retângulo dos limites [oeste, sul, leste, norte]. */
export function poligonoDeLimites([oeste, sul, leste, norte]: number[]): PoligonoGeoJson {
  return poligonoDeCantos([oeste!, sul!], [leste!, norte!]);
}

/** Polígono dos vértices (mínimo de três); `null` se não houver. */
export function poligonoDeVertices(vertices: Ponto[]): PoligonoGeoJson | null {
  return vertices.length >= 3 ? { type: "Polygon", coordinates: [fechar(vertices)] } : null;
}

type Feicao = { type: "Feature"; properties: Record<string, never>; geometry: unknown };
const feicao = (geometry: unknown): Feicao => ({ type: "Feature", properties: {}, geometry });

/** Feições do rascunho: o polígono (ou a linha, com dois pontos) e os vértices. */
export function feicoesDoRascunho(vertices: Ponto[], cursor?: Ponto): unknown[] {
  const pontos = cursor ? [...vertices, cursor] : vertices;
  const poligono = poligonoDeVertices(pontos);
  return [
    ...(poligono
      ? [feicao(poligono)]
      : pontos.length === 2
        ? [feicao({ type: "LineString", coordinates: pontos })]
        : []),
    ...vertices.map((v) => feicao({ type: "Point", coordinates: v })),
  ];
}

function definirDados(m: MapaMapLibre, fonte: string, feicoes: unknown[]) {
  (m.getSource(fonte) as GeoJSONSource | undefined)?.setData(
    (feicoes.length ? { type: "FeatureCollection", features: feicoes } : VAZIO) as never,
  );
}

/** Fontes e camadas da área concluída e do rascunho; ficam abaixo de `antesDe`. */
export function adicionarCamadasArea(m: MapaMapLibre, antesDe?: string): void {
  for (const fonte of [FONTE_AREA, FONTE_RASCUNHO]) {
    m.addSource(fonte, { type: "geojson", data: VAZIO as never });
    m.addLayer(
      {
        id: `${fonte}-preenchimento`,
        type: "fill",
        source: fonte,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": COR_SELECAO,
          "fill-opacity": fonte === FONTE_AREA ? 0.1 : 0.06,
        },
      },
      antesDe,
    );
    m.addLayer(
      {
        id: `${fonte}-contorno`,
        type: "line",
        source: fonte,
        filter: ["!=", ["geometry-type"], "Point"],
        layout: { "line-join": "round" },
        paint: { "line-color": COR_SELECAO, "line-width": 2.5, "line-dasharray": [2, 1.5] },
      },
      antesDe,
    );
  }
  m.addLayer(
    {
      id: `${FONTE_RASCUNHO}-vertices`,
      type: "circle",
      source: FONTE_RASCUNHO,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 4.5,
        "circle-color": "#ffffff",
        "circle-stroke-color": COR_SELECAO,
        "circle-stroke-width": 2,
      },
    },
    antesDe,
  );
}

/** Mostra a área concluída (contorno tracejado) ou, com `null`, remove. */
export function definirArea(m: MapaMapLibre, area: PoligonoGeoJson | null): void {
  definirDados(m, FONTE_AREA, area ? [feicao(area)] : []);
}

function definirRascunho(m: MapaMapLibre, feicoes: unknown[]): void {
  definirDados(m, FONTE_RASCUNHO, feicoes);
}

interface EventoMapa {
  lngLat: { lng: number; lat: number };
  point: { x: number; y: number };
  originalEvent?: { button?: number };
  preventDefault?: () => void;
}

export interface OpcoesDesenho {
  aoConcluir: (area: PoligonoGeoJson) => void;
  aoCancelar: () => void;
}

const distancia = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Liga o modo de desenho no mapa. Devolve a função que o encerra: remove os
 * eventos, devolve ao mapa o arrasto e o zoom por duplo clique e limpa o rascunho.
 */
export function iniciarDesenho(
  m: MapaMapLibre,
  forma: FormaArea,
  { aoConcluir, aoCancelar }: OpcoesDesenho,
): () => void {
  const alvo = m as unknown as {
    on: (evento: string, fn: (e: EventoMapa) => void) => void;
    off: (evento: string, fn: (e: EventoMapa) => void) => void;
  };
  const desfazer: (() => void)[] = [];
  const ouvir = (evento: string, fn: (e: EventoMapa) => void) => {
    alvo.on(evento, fn);
    desfazer.push(() => alvo.off(evento, fn));
  };
  const ouvirTeclado = (fn: (e: KeyboardEvent) => void) => {
    document.addEventListener("keydown", fn);
    desfazer.push(() => document.removeEventListener("keydown", fn));
  };
  const ponto = (e: EventoMapa): Ponto => [e.lngLat.lng, e.lngLat.lat];

  m.getCanvas().style.cursor = "crosshair";
  m.doubleClickZoom.disable();

  if (forma === "retangulo") {
    let inicio: { ponto: Ponto; tela: { x: number; y: number } } | null = null;
    m.dragPan.disable();
    ouvir("mousedown", (e) => {
      if (e.originalEvent?.button) return;
      inicio = { ponto: ponto(e), tela: e.point };
    });
    ouvir("mousemove", (e) => {
      if (inicio) definirRascunho(m, [feicao(poligonoDeCantos(inicio.ponto, ponto(e)))]);
    });
    ouvir("mouseup", (e) => {
      if (!inicio) return;
      const { ponto: a, tela } = inicio;
      inicio = null;
      definirRascunho(m, []);
      if (distancia(tela, e.point) >= ARRASTO_MINIMO_PX) aoConcluir(poligonoDeCantos(a, ponto(e)));
    });
  } else {
    const vertices: { ponto: Ponto; tela: { x: number; y: number } }[] = [];
    const pontos = () => vertices.map((v) => v.ponto);
    const concluir = () => {
      const poligono = poligonoDeVertices(pontos());
      if (poligono) aoConcluir(poligono);
    };
    ouvir("click", (e) => {
      const ultimo = vertices.at(-1);
      // O duplo clique dispara dois cliques no mesmo lugar: conta um vértice só.
      if (ultimo && distancia(ultimo.tela, e.point) < VERTICE_REPETIDO_PX) return;
      vertices.push({ ponto: ponto(e), tela: e.point });
      definirRascunho(m, feicoesDoRascunho(pontos()));
    });
    ouvir("mousemove", (e) => {
      if (vertices.length) definirRascunho(m, feicoesDoRascunho(pontos(), ponto(e)));
    });
    ouvir("dblclick", (e) => {
      e.preventDefault?.();
      concluir();
    });
    ouvirTeclado((e) => {
      // Teclas de campos de formulário (ex.: busca) não editam o desenho.
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      if (e.key === "Enter" && vertices.length >= 3) {
        e.preventDefault();
        concluir();
      } else if (e.key === "Backspace" && vertices.length) {
        e.preventDefault();
        vertices.pop();
        definirRascunho(m, feicoesDoRascunho(pontos()));
      }
    });
  }

  ouvirTeclado((e) => {
    if (e.key === "Escape") aoCancelar();
  });

  return () => {
    for (const f of desfazer) f();
    definirRascunho(m, []);
    m.getCanvas().style.cursor = "";
    m.doubleClickZoom.enable();
    m.dragPan.enable();
  };
}
