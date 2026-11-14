/** Mês (AAAA-MM) ainda em andamento na data do cálculo: o último da série quando coincide
 * com o mês de `calculadoEm`. Sem isso a queda do mês corrente parece real (R3-18). */
export function mesEmAndamento(meses: string[], calculadoEm: string | undefined): string | null {
  const ultimo = meses[meses.length - 1];
  if (!ultimo || !calculadoEm) return null;
  return calculadoEm.slice(0, 7) === ultimo ? ultimo : null;
}
