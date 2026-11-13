import { useState } from "react";

/** Registros por ação em lote. O servidor é quem impõe (`LIMITE_ACOES_EM_LOTE`); aqui só avisa antes. */
export const LIMITE_ACOES_EM_LOTE = 200;
/** Até aqui, "todos os filtrados" acima de 200 roda em segundo plano (M-26). */
export const LIMITE_OPERACAO_EM_LOTE = 20000;

/** A ação não pode ser enviada: marcadas passam de 200, ou filtradas passam do teto em segundo plano. */
export function excedeLimiteDoLote(total: number, todosFiltrados: boolean): boolean {
  return total > (todosFiltrados ? LIMITE_OPERACAO_EM_LOTE : LIMITE_ACOES_EM_LOTE);
}

/** O que a ação em lote alcança: as linhas marcadas ou todas as que os filtros mostram (M-23). */
export type AlvoLote = { ids: string[] } | { filtros: Record<string, string> };

/**
 * Seleção por caixas de seleção em uma lista paginada. Atravessa as páginas, mas só vale
 * para os filtros em que foi feita: mudou o filtro, a seleção recomeça vazia.
 *
 * Com a página inteira marcada e mais registros além dela, `podeSelecionarTodos` oferece
 * "Selecionar todos os N filtrados": a ação passa a valer para os filtros, não para ids.
 */
export function useSelecaoEmLote(
  chaveDosFiltros: string,
  idsDaPagina: string[],
  totalFiltrado = 0,
) {
  const [estado, setEstado] = useState<{ chave: string; ids: string[]; todos: boolean }>({
    chave: "",
    ids: [],
    todos: false,
  });
  const vale = estado.chave === chaveDosFiltros;
  const selecionadas = vale ? estado.ids : [];
  const todosFiltrados = vale && estado.todos;
  const definir = (ids: string[]) => setEstado({ chave: chaveDosFiltros, ids, todos: false });
  const marcadasNaPagina = idsDaPagina.filter((id) => selecionadas.includes(id));
  const paginaInteira = idsDaPagina.length > 0 && marcadasNaPagina.length === idsDaPagina.length;
  return {
    selecionadas,
    /** Quantos registros a ação alcança: os filtrados, quando "todos" está ligado. */
    total: todosFiltrados ? totalFiltrado : selecionadas.length,
    todosFiltrados,
    podeSelecionarTodos: !todosFiltrados && paginaInteira && totalFiltrado > selecionadas.length,
    selecionarTodosFiltrados: () =>
      setEstado({ chave: chaveDosFiltros, ids: selecionadas, todos: true }),
    alvo: (filtros: Record<string, string>): AlvoLote =>
      todosFiltrados ? { filtros } : { ids: selecionadas },
    paginaInteira,
    paginaParcial: marcadasNaPagina.length > 0 && !paginaInteira,
    marcada: (id: string) => selecionadas.includes(id),
    alternar: (id: string, marcado: boolean) =>
      definir(marcado ? [...selecionadas, id] : selecionadas.filter((x) => x !== id)),
    alternarPagina: (marcado: boolean) =>
      definir(
        marcado
          ? [...selecionadas, ...idsDaPagina.filter((id) => !selecionadas.includes(id))]
          : selecionadas.filter((id) => !idsDaPagina.includes(id)),
      ),
    limpar: () => definir([]),
  };
}
