import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalida todas as consultas cujo caminho começa com algum dos prefixos.
 * As chaves geradas pelo Orval são o caminho completo (ex.: "/api/v1/arvores/x/historico").
 */
export function invalidarCaminhos(cliente: QueryClient, ...prefixos: string[]) {
  return cliente.invalidateQueries({
    predicate: (consulta) => {
      const caminho = consulta.queryKey[0];
      return typeof caminho === "string" && prefixos.some((p) => caminho.startsWith(p));
    },
  });
}
