/** Campos pelos quais a lista de árvores pode ser ordenada (`-` na frente = decrescente). */
export const CAMPOS_ORDENACAO = [
  "numero",
  "atualizado_em",
  "ultima_inspecao_em",
  "condicao_aparente",
] as const;

export type CampoOrdenacao = (typeof CAMPOS_ORDENACAO)[number];

/**
 * "Nunca inspecionadas primeiro" (M-15): prioriza o atraso. As nunca inspecionadas vão ao topo e,
 * depois delas, a inspeção mais antiga vem antes. Não tem direção oposta.
 */
export const ORDENACAO_ATRASO = "atraso";

export const ORDENACOES_ARVORES = [
  ...CAMPOS_ORDENACAO.flatMap((c) => [c, `-${c}`] as const),
  ORDENACAO_ATRASO,
] as const;

export type Ordenacao = (typeof ORDENACOES_ARVORES)[number];

/** Direção atual de um campo, para o `aria-sort` do cabeçalho. */
export function direcaoDe(atual: Ordenacao, campo: CampoOrdenacao): "asc" | "desc" | undefined {
  // Do mais antigo para o mais recente, como a crescente, mas com as nunca inspecionadas antes.
  if (atual === ORDENACAO_ATRASO) return campo === "ultima_inspecao_em" ? "asc" : undefined;
  return atual === campo ? "asc" : atual === `-${campo}` ? "desc" : undefined;
}

/** Próxima ordenação ao clicar no cabeçalho: primeiro decrescente, depois alterna. */
export function proximaOrdenacao(atual: Ordenacao, campo: CampoOrdenacao): Ordenacao {
  return atual === `-${campo}` ? campo : `-${campo}`;
}
