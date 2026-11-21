/** Texto do cabeçalho da coluna de valor de cada análise por bairro (R3-14). */
export const ROTULO_VALOR: Record<string, string> = {
  arvores_por_bairro: "Árvores",
  arborizacao_entorno_por_bairro: "Faces com árvore",
  manejo_urbfor_por_bairro: "Árvores com manejo",
  mudas_doadas_por_especie: "Mudas doadas",
  mudas_doadas_por_categoria: "Mudas doadas",
  plantios_por_bairro: "Mudas plantadas",
  arvores_por_mil_habitantes_por_bairro: "Árvores por 1.000 hab. (provisório)",
  populacao_densidade_por_bairro: "Habitantes (Censo 2022)",
  arvores_mil_x_renda: "Árvores por 1.000 hab. (provisório)",
};

/** O que significa um bairro com valor zero, para o grupo recolhido ("Sem árvores no escopo"). */
export const ROTULO_SEM_VALOR: Record<string, string> = {
  arvores_por_bairro: "Sem árvores no escopo",
  manejo_urbfor_por_bairro: "Sem manejo identificado",
  plantios_por_bairro: "Sem plantio identificado",
  arvores_por_mil_habitantes_por_bairro: "Sem árvores cadastradas",
  arvores_mil_x_renda: "Sem árvores cadastradas",
};

/**
 * Num ranking por bairro, os bairros com valor zero (114 de 121, por exemplo) vão para um grupo
 * recolhido: ficam fora da rolagem sem esconder que existem. Percentual não se recolhe: 0% é um
 * valor medido, não ausência.
 */
export function separarZeros<T extends { valor: number }>(
  linhas: T[],
  porBairro: boolean,
  percentual: boolean,
): { principais: T[]; zeros: T[] } {
  if (!porBairro || percentual) return { principais: linhas, zeros: [] };
  const zeros = linhas.filter((l) => l.valor === 0);
  // Só zeros: não há o que recolher, a tabela principal ficaria vazia.
  if (zeros.length === linhas.length) return { principais: linhas, zeros: [] };
  return { principais: linhas.filter((l) => l.valor !== 0), zeros };
}

export type CriterioOrdem = "maior" | "menor" | "nome";

export const ROTULOS_ORDEM: Record<CriterioOrdem, string> = {
  maior: "Maior valor primeiro",
  menor: "Menor valor primeiro",
  nome: "Nome do bairro (A a Z)",
};

/** Ordena as linhas de uma análise por bairro sem alterar o vetor original. */
export function ordenarLinhas<T extends { rotulo: string; valor: number }>(
  linhas: T[],
  criterio: CriterioOrdem,
): T[] {
  const copia = [...linhas];
  if (criterio === "nome") return copia.sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  const sinal = criterio === "maior" ? -1 : 1;
  return copia.sort(
    (a, b) => sinal * (a.valor - b.valor) || a.rotulo.localeCompare(b.rotulo, "pt-BR"),
  );
}

/** Texto que planilhas interpretariam como fórmula (CWE-1236): ganha um apóstrofo na frente. */
const PREFIXOS_FORMULA = ["=", "+", "-", "@", "\t", "\r"];

function celulaCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  let texto = typeof valor === "number" ? String(valor).replace(".", ",") : String(valor);
  if (typeof valor === "string" && PREFIXOS_FORMULA.some((p) => texto.startsWith(p)))
    texto = `'${texto}`;
  return /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * CSV de uma análise: linhas de comentário com título, fonte e ressalvas, o cabeçalho e uma linha
 * por bairro, separado por ponto e vírgula e com BOM (abre direto no Excel em português).
 */
export function gerarCsv(
  colunas: { chave: string; rotulo: string }[],
  linhas: Record<string, unknown>[],
  meta: { titulo: string; fonte: string; calculadoEm: string; ressalvas: string[] },
): string {
  const comentarios = [
    `# ${meta.titulo}`,
    `# fonte: ${meta.fonte}`,
    `# calculado em: ${meta.calculadoEm}`,
    ...meta.ressalvas.map((r) => `# ressalva: ${r}`),
  ];
  const corpo = linhas.map((l) => colunas.map((c) => celulaCsv(l[c.chave])).join(";"));
  return (
    "\ufeff" +
    [...comentarios, colunas.map((c) => celulaCsv(c.rotulo)).join(";"), ...corpo].join("\r\n") +
    "\r\n"
  );
}
