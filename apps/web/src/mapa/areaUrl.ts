/**
 * Área de seleção na URL (RF-MAPA-022, M-12). O anel do polígono vira texto curto:
 * cada coordenada em microgrados (6 casas, cerca de 0,1 m), o primeiro vértice
 * absoluto e os demais como diferença do anterior, tudo em base 36 e separado por
 * "_". Um retângulo de bairro cabe em cerca de 40 caracteres. O vértice de
 * fechamento não é gravado.
 *
 * Exemplo: o vértice `-38.56,-3.76` seguido de um deslocamento de `0.01,0.01` → `-myh34_-28l8g_7ps_7ps`.
 * Texto inválido não quebra a tela: `decodificarArea` devolve `null`.
 */
import type { PoligonoGeoJson, Ponto } from "./desenho";

const ESCALA = 1_000_000;
/** Mais vértices que isto não cabem no endereço: `decodificarArea` recusa o texto. */
export const MAX_VERTICES = 200;
/**
 * Simplificação de polígonos grandes (M-19): Douglas-Peucker sobre o anel, com tolerância
 * inicial de 1 m, menor que a incerteza de um clique no mapa (cerca de 1 px, de 0,3 a 5 m nos
 * zooms usados) e que a de um GPS de celular. Se ainda passar de `MAX_VERTICES`, a tolerância
 * dobra (2 m, 4 m, 8 m...) até caber. Cada vértice mantido é um vértice original, nunca um
 * ponto novo, e a forma não se afasta mais que a tolerância usada. O resultado pode, em casos
 * raros e com tolerância alta, cruzar a si mesmo; a API da seleção rejeita polígono inválido.
 */
export const TOLERANCIA_INICIAL_M = 1;

const METROS_POR_GRAU_LAT = 110_574;
const METROS_POR_GRAU_LON_NO_EQUADOR = 111_320;

export interface AreaSimplificada {
  area: PoligonoGeoJson;
  verticesAntes: number;
  verticesDepois: number;
  /** Tolerância (m) com que se chegou ao resultado; `null` quando não foi preciso simplificar. */
  toleranciaM: number | null;
}

/** Distância (m) do ponto `p` ao segmento `a`-`b`, em coordenadas já planas (m). */
function distanciaAoSegmento(p: Ponto, a: Ponto, b: Ponto): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const comprimento2 = dx * dx + dy * dy;
  const t = comprimento2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / comprimento2;
  const k = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + k * dx), p[1] - (a[1] + k * dy));
}

/** Douglas-Peucker iterativo sobre uma linha aberta: quais índices ficam (as pontas sempre). */
function douglasPeucker(pontos: Ponto[], tolerancia: number): boolean[] {
  const fica = new Array<boolean>(pontos.length).fill(false);
  fica[0] = fica[pontos.length - 1] = true;
  const pilha: [number, number][] = [[0, pontos.length - 1]];
  while (pilha.length) {
    const [ini, fim] = pilha.pop()!;
    let maior = -1;
    let indice = -1;
    for (let i = ini + 1; i < fim; i++) {
      const d = distanciaAoSegmento(pontos[i]!, pontos[ini]!, pontos[fim]!);
      if (d > maior) [maior, indice] = [d, i];
    }
    if (indice !== -1 && maior > tolerancia) {
      fica[indice] = true;
      pilha.push([ini, indice], [indice, fim]);
    }
  }
  return fica;
}

/** Mantém o polígono até `MAX_VERTICES` vértices; acima disso, simplifica (ver acima). */
export function simplificarArea(area: PoligonoGeoJson): AreaSimplificada {
  const original = area.coordinates[0]!.slice(0, -1);
  const antes = original.length;
  if (antes <= MAX_VERTICES) {
    return { area, verticesAntes: antes, verticesDepois: antes, toleranciaM: null };
  }
  // Plano local em metros (a escala da longitude depende da latitude média).
  const latMedia = original.reduce((soma, [, lat]) => soma + lat, 0) / antes;
  const kLon = METROS_POR_GRAU_LON_NO_EQUADOR * Math.cos((latMedia * Math.PI) / 180);
  const plano = original.map(([lon, lat]) => [lon * kLon, lat * METROS_POR_GRAU_LAT] as Ponto);
  // O anel é partido em duas linhas, no vértice mais distante do primeiro.
  const distanciaDoPrimeiro = (i: number) =>
    Math.hypot(plano[i]![0] - plano[0]![0], plano[i]![1] - plano[0]![1]);
  let meio = 1;
  for (let i = 2; i < antes; i++) if (distanciaDoPrimeiro(i) > distanciaDoPrimeiro(meio)) meio = i;
  const primeira = plano.slice(0, meio + 1);
  const segunda = [...plano.slice(meio), plano[0]!];
  let tolerancia = TOLERANCIA_INICIAL_M;
  for (;;) {
    const a = douglasPeucker(primeira, tolerancia);
    const b = douglasPeucker(segunda, tolerancia);
    const indices = [
      ...a.flatMap((f, i) => (f ? [i] : [])),
      ...b.flatMap((f, i) => (f && i > 0 && i < segunda.length - 1 ? [meio + i] : [])),
    ];
    if (indices.length <= MAX_VERTICES || tolerancia > 1e6) {
      const vertices = indices.map((i) => original[i]!);
      return {
        area: { type: "Polygon", coordinates: [[...vertices, vertices[0]!]] },
        verticesAntes: antes,
        verticesDepois: vertices.length,
        toleranciaM: tolerancia,
      };
    }
    tolerancia *= 2;
  }
}

const micro = (graus: number) => Math.round(graus * ESCALA);

/** Anel sem o vértice de fechamento, com as coordenadas arredondadas a 6 casas. */
export function arredondarArea(area: PoligonoGeoJson): PoligonoGeoJson {
  const anel = area.coordinates[0]!.slice(0, -1).map(
    ([x, y]) => [micro(x) / ESCALA, micro(y) / ESCALA] as Ponto,
  );
  return { type: "Polygon", coordinates: [[...anel, anel[0]!]] };
}

export function codificarArea(area: PoligonoGeoJson): string {
  const vertices = area.coordinates[0]!.slice(0, -1);
  let anteriorX = 0;
  let anteriorY = 0;
  return vertices
    .flatMap(([x, y]) => {
      const mx = micro(x);
      const my = micro(y);
      const par = [(mx - anteriorX).toString(36), (my - anteriorY).toString(36)];
      anteriorX = mx;
      anteriorY = my;
      return par;
    })
    .join("_");
}

export function decodificarArea(texto: string | undefined): PoligonoGeoJson | null {
  if (!texto) return null;
  const partes = texto.split("_");
  if (partes.length % 2 !== 0 || partes.length < 6 || partes.length > MAX_VERTICES * 2) return null;
  const vertices: Ponto[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < partes.length; i += 2) {
    if (!/^-?[0-9a-z]+$/.test(partes[i]!) || !/^-?[0-9a-z]+$/.test(partes[i + 1]!)) return null;
    x += parseInt(partes[i]!, 36);
    y += parseInt(partes[i + 1]!, 36);
    const lon = x / ESCALA;
    const lat = y / ESCALA;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    vertices.push([lon, lat]);
  }
  return { type: "Polygon", coordinates: [[...vertices, vertices[0]!]] };
}
