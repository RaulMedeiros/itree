/** Quantos filtros a pessoa escolheu (página e ordem não contam; `ignorar` tira os valores-padrão). */
export function contarFiltros(filtros: object, ignorar: string[] = []): number {
  const fora = new Set(["pagina", "ordenar", "ordem", ...ignorar]);
  return Object.entries(filtros).filter(([k, v]) => !fora.has(k) && v !== undefined && v !== "")
    .length;
}

/** Separa "/inspecoes?estado=devolvida" em caminho e parâmetros, como o roteador espera. */
export function destinoDoLink(link: string): never {
  const [caminho = "/", consulta = ""] = link.split("?");
  // O link vem do servidor como texto; o roteador só conhece os caminhos tipados.
  return { to: caminho, search: Object.fromEntries(new URLSearchParams(consulta)) } as never;
}
