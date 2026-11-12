import { useState } from "react";

/** Registros por ação em lote. O servidor é quem impõe (`LIMITE_ACOES_EM_LOTE`); aqui só avisa antes. */
export const LIMITE_ACOES_EM_LOTE = 200;

/**
 * Seleção por caixas de seleção em uma lista paginada. Atravessa as páginas, mas só vale
 * para os filtros em que foi feita: mudou o filtro, a seleção recomeça vazia.
 */
export function useSelecaoEmLote(chaveDosFiltros: string, idsDaPagina: string[]) {
  const [estado, setEstado] = useState<{ chave: string; ids: string[] }>({ chave: "", ids: [] });
  const selecionadas = estado.chave === chaveDosFiltros ? estado.ids : [];
  const definir = (ids: string[]) => setEstado({ chave: chaveDosFiltros, ids });
  const marcadasNaPagina = idsDaPagina.filter((id) => selecionadas.includes(id));
  const paginaInteira = idsDaPagina.length > 0 && marcadasNaPagina.length === idsDaPagina.length;
  return {
    selecionadas,
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
