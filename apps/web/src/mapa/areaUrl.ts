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
const MAX_VERTICES = 200;

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
