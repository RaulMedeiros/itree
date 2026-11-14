export interface FonteTerritorio {
  fonte: string;
  fonte_url?: string | null;
}

const chave = (t: FonteTerritorio) => `${t.fonte}\u0000${t.fonte_url ?? ""}`;

/**
 * A fonte que a maioria dos territórios tem em comum (R3-27): mostrada uma vez, acima da tabela.
 * Devolve null sem territórios. Em empate vence a que aparece primeiro.
 */
export function fonteComum<T extends FonteTerritorio>(territorios: T[]): FonteTerritorio | null {
  const contagem = new Map<string, { fonte: FonteTerritorio; n: number }>();
  for (const t of territorios) {
    const atual = contagem.get(chave(t));
    if (atual) atual.n += 1;
    else contagem.set(chave(t), { fonte: { fonte: t.fonte, fonte_url: t.fonte_url }, n: 1 });
  }
  let melhor: { fonte: FonteTerritorio; n: number } | null = null;
  for (const c of contagem.values()) if (!melhor || c.n > melhor.n) melhor = c;
  return melhor?.fonte ?? null;
}

/** Na linha, a fonte só aparece quando difere da comum. */
export function divergeDaFonteComum(t: FonteTerritorio, comum: FonteTerritorio | null): boolean {
  return !comum || chave(t) !== chave(comum);
}
