/** Quantos filtros a pessoa escolheu (página e ordem não contam; `ignorar` tira os valores-padrão). */
export function contarFiltros(filtros: object, ignorar: string[] = []): number {
  const fora = new Set(["pagina", "ordenar", "ordem", ...ignorar]);
  return Object.entries(filtros).filter(([k, v]) => !fora.has(k) && v !== undefined && v !== "")
    .length;
}
