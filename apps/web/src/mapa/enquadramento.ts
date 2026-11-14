/** Caixa [oeste, sul, leste, norte] em graus. */
export type Caixa = [number, number, number, number];

/**
 * Menor caixa que contém os pontos `[lon, lat]`, ou null sem pontos. Serve para enquadrar o mapa
 * pelo que há de dado, e não pelo município inteiro (R3-16). Um ponto só (ou todos no mesmo lugar)
 * ganha uma folga mínima para o `fitBounds` não ampliar até o zoom máximo.
 */
export function limitesDosPontos(
  pontos: ReadonlyArray<readonly [number, number]>,
  folgaMinima = 0.002,
): Caixa | null {
  if (pontos.length === 0) return null;
  let oeste = Infinity;
  let sul = Infinity;
  let leste = -Infinity;
  let norte = -Infinity;
  for (const [lon, lat] of pontos) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    oeste = Math.min(oeste, lon);
    leste = Math.max(leste, lon);
    sul = Math.min(sul, lat);
    norte = Math.max(norte, lat);
  }
  if (!Number.isFinite(oeste)) return null;
  if (leste - oeste < folgaMinima) {
    oeste -= folgaMinima / 2;
    leste += folgaMinima / 2;
  }
  if (norte - sul < folgaMinima) {
    sul -= folgaMinima / 2;
    norte += folgaMinima / 2;
  }
  return [oeste, sul, leste, norte];
}

/** Largura que o painel de camadas ocupa sobre o mapa: `left-3` (12 px) mais `w-80` (320 px). */
export const LARGURA_PAINEL_CAMADAS_PX = 332;

/**
 * Folga para o `fitBounds` e o `setPadding`: o painel de camadas cobre cerca de 25% do mapa, e o
 * enquadramento que o ignora deixa o oeste do município escondido atrás dele (R3-21).
 */
export function paddingDoMapa(painelAberto: boolean, folga = 40) {
  return {
    top: folga,
    right: folga,
    bottom: folga,
    left: painelAberto ? LARGURA_PAINEL_CAMADAS_PX + folga : folga,
  };
}
