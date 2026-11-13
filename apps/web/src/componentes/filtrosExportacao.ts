/** Parâmetros da lista em texto, como a exportação espera: sem vazios e sem página nem ordem. */
export function filtrosParaExportar(
  filtros: Record<string, string | number | boolean | undefined | null>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filtros)
      .filter(
        ([k, v]) =>
          v !== undefined &&
          v !== null &&
          v !== "" &&
          !["pagina", "tamanho", "ordenar", "ordem"].includes(k),
      )
      .map(([k, v]) => [k, String(v)]),
  );
}
