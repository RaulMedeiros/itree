import type { PontoCondicao } from "@itree/api-client";

/** Níveis do gráfico de condição, de cima (melhor) para baixo (pior). */
export const NIVEIS_CONDICAO = ["boa", "regular", "ruim", "morta", "nao_avaliada"] as const;
export type NivelCondicao = (typeof NIVEIS_CONDICAO)[number];

export const nivelDaCondicao = (c: string): NivelCondicao =>
  (NIVEIS_CONDICAO as readonly string[]).includes(c) ? (c as NivelCondicao) : "nao_avaliada";

export interface Degrau {
  nivel: NivelCondicao;
  /** Instantes (ms) em que a condição passou a valer e em que deixou de valer. */
  de: number;
  ate: number;
  inspecao: string;
}

/**
 * Condição como degraus: cada inspeção validada vale até a seguinte; a última vale até `fim`
 * (hoje), porque a condição aparente continua sendo a da última inspeção validada.
 */
export function degraus(pontos: readonly PontoCondicao[], fim: number): Degrau[] {
  const ordenados = [...pontos].sort((a, b) => Date.parse(a.data) - Date.parse(b.data));
  return ordenados.map((p, i) => {
    const de = Date.parse(p.data);
    const proximo = ordenados[i + 1];
    return {
      nivel: nivelDaCondicao(p.condicao),
      de,
      ate: proximo ? Date.parse(proximo.data) : Math.max(fim, de),
      inspecao: p.inspecao_codigo,
    };
  });
}

/** Posição (0 a 1) de `t` entre `min` e `max`; com intervalo nulo, o meio. */
export const posicaoNaEscala = (t: number, min: number, max: number) =>
  max > min ? (t - min) / (max - min) : 0.5;
