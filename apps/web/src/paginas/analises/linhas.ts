/** Texto do cabeçalho da coluna de valor de cada análise por bairro (R3-14). */
export const ROTULO_VALOR: Record<string, string> = {
  arvores_por_bairro: "Árvores",
  arborizacao_entorno_por_bairro: "Faces com árvore",
  manejo_urbfor_por_bairro: "Árvores com manejo",
  mudas_doadas_por_especie: "Mudas doadas",
  mudas_doadas_por_categoria: "Mudas doadas",
  plantios_por_bairro: "Mudas plantadas",
};

/** O que significa um bairro com valor zero, para o grupo recolhido ("Sem árvores no escopo"). */
export const ROTULO_SEM_VALOR: Record<string, string> = {
  arvores_por_bairro: "Sem árvores no escopo",
  manejo_urbfor_por_bairro: "Sem manejo identificado",
  plantios_por_bairro: "Sem plantio identificado",
};

/**
 * Num ranking por bairro, os bairros com valor zero (114 de 121, por exemplo) vão para um grupo
 * recolhido: ficam fora da rolagem sem esconder que existem. Percentual não se recolhe: 0% é um
 * valor medido, não ausência.
 */
export function separarZeros<T extends { valor: number }>(
  linhas: T[],
  porBairro: boolean,
  percentual: boolean,
): { principais: T[]; zeros: T[] } {
  if (!porBairro || percentual) return { principais: linhas, zeros: [] };
  const zeros = linhas.filter((l) => l.valor === 0);
  // Só zeros: não há o que recolher, a tabela principal ficaria vazia.
  if (zeros.length === linhas.length) return { principais: linhas, zeros: [] };
  return { principais: linhas.filter((l) => l.valor !== 0), zeros };
}
