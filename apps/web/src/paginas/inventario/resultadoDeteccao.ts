import type { ResultadoDeteccao } from "@itree/domain";

/**
 * Cor de cada resultado no mapa do lote. A cor sempre vem com o texto da legenda; além disso a
 * recusada é vazada e a possível remoção ganha anel, para não depender só da cor.
 */
export const CORES_RESULTADO_DETECCAO: Record<ResultadoDeteccao, string> = {
  criada: "#2b8a3e",
  juntada: "#1c7ed6",
  ponto_plantio: "#f08c00",
  recusada: "#868e96",
  possivel_remocao: "#c92a2a",
};

export interface FeicaoDeteccao {
  geometry: { coordinates: [number, number] };
  properties: { resultado: ResultadoDeteccao } & Record<string, unknown>;
}

/** Quantas detecções de cada resultado há no GeoJSON do lote. */
export function contarResultados(
  feicoes: readonly Pick<FeicaoDeteccao, "properties">[],
): Record<ResultadoDeteccao, number> {
  const contagem: Record<ResultadoDeteccao, number> = {
    criada: 0,
    juntada: 0,
    ponto_plantio: 0,
    recusada: 0,
    possivel_remocao: 0,
  };
  for (const f of feicoes) {
    if (f.properties.resultado in contagem) contagem[f.properties.resultado] += 1;
  }
  return contagem;
}
