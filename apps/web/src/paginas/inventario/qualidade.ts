export interface Pendencia {
  id: string;
  titulo: string;
  criterio: string;
  quantidade: number;
  gravidade: "alta" | "media" | "baixa";
  link: { pagina: string; filtros: Record<string, string> } | null;
  exemplos?: { arvore: string; arvore_id: string; tipo: string; valor: number; unidade: string }[];
}

const PESO_GRAVIDADE = { alta: 0, media: 1, baixa: 2 } as const;

/** Com problema primeiro: gravidade maior antes, e dentro dela a maior quantidade. */
export function ordenarPendencias(itens: Pendencia[]): {
  comProblema: Pendencia[];
  semProblema: Pendencia[];
} {
  const comProblema = itens
    .filter((p) => p.quantidade > 0)
    .sort(
      (a, b) =>
        PESO_GRAVIDADE[a.gravidade] - PESO_GRAVIDADE[b.gravidade] || b.quantidade - a.quantidade,
    );
  return { comProblema, semProblema: itens.filter((p) => p.quantidade === 0) };
}
