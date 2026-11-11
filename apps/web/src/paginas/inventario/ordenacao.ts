/** Campos pelos quais a lista de árvores pode ser ordenada (`-` na frente = decrescente). */
export const CAMPOS_ORDENACAO = [
  "numero",
  "atualizado_em",
  "ultima_inspecao_em",
  "condicao_aparente",
] as const;

export type CampoOrdenacao = (typeof CAMPOS_ORDENACAO)[number];

export const ORDENACOES_ARVORES = CAMPOS_ORDENACAO.flatMap((c) => [c, `-${c}`] as const);

export type Ordenacao = (typeof ORDENACOES_ARVORES)[number];

/** Direção atual de um campo, para o `aria-sort` do cabeçalho. */
export function direcaoDe(atual: Ordenacao, campo: CampoOrdenacao): "asc" | "desc" | undefined {
  return atual === campo ? "asc" : atual === `-${campo}` ? "desc" : undefined;
}

/** Próxima ordenação ao clicar no cabeçalho: primeiro decrescente, depois alterna. */
export function proximaOrdenacao(atual: Ordenacao, campo: CampoOrdenacao): Ordenacao {
  return atual === `-${campo}` ? campo : `-${campo}`;
}
