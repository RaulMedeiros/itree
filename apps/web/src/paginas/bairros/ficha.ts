import type { FichaCartao } from "@itree/api-client";

import { formatarData } from "../../util/formatos";

const inteiro = new Intl.NumberFormat("pt-BR");
const decimal1 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});
const decimal3 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const decimal2 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Valor do cartão como a pessoa lê: "54,3%", "+0,43 °C" ou "1.234". Sem valor, um traço. */
export function formatarValorCartao(c: Pick<FichaCartao, "valor" | "unidade">): string {
  if (c.valor === null || c.valor === undefined) return "—";
  if (c.unidade === "%") return `${decimal1.format(c.valor)}%`;
  if (c.unidade === "°C") return `${c.valor > 0 ? "+" : ""}${decimal2.format(c.valor)} °C`;
  if (c.unidade === "R$") return `R$ ${inteiro.format(Math.round(c.valor))}`;
  if (c.unidade === "hab/km²") return `${inteiro.format(Math.round(c.valor))} hab/km²`;
  if (c.unidade === "por 1.000 hab.") return `${decimal2.format(c.valor)} por 1.000 hab.`;
  if (c.unidade === "IDH") return decimal3.format(c.valor);
  return inteiro.format(c.valor);
}

/** "Fonte: X · dados de 31/07/2022", ou só a fonte quando não há data. */
export function textoDaFonte(c: Pick<FichaCartao, "fonte" | "data_referencia">): string {
  const data = formatarData(c.data_referencia);
  return data ? `${c.fonte} · dados de ${data}` : c.fonte;
}

/** Posição (0 a 100) na régua de percentuais, sem sair da trilha. */
export const posicaoNaReguaPct = (valor: number): number => Math.min(100, Math.max(0, valor));

/**
 * Posição (0 a 100) na régua de um indicador que não é percentual: o menor e o maior valor entre os
 * bairros são as pontas. Sem escala (ou com uma só), o meio da trilha.
 */
export function posicaoNaEscala(
  valor: number,
  escala: { min: number; max: number } | null | undefined,
): number {
  if (!escala || escala.max <= escala.min) return 50;
  return Math.min(100, Math.max(0, ((valor - escala.min) / (escala.max - escala.min)) * 100));
}

/** "Aldeota: 54,3% · Média de Fortaleza: 48,0%", para o leitor de tela. */
export function descricaoDaRegua(c: FichaCartao, nome: string): string {
  if (c.valor === null || !c.cidade) return "";
  return `${nome}: ${formatarValorCartao(c)}. ${c.cidade.rotulo}: ${formatarValorCartao({ valor: c.cidade.valor, unidade: c.unidade })}.`;
}

/** Mês AAAA-MM como "jan/26". */
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function rotuloDoMes(m: string): string {
  const [ano, mes] = m.split("-").map(Number);
  return `${MESES[(mes ?? 1) - 1]}/${String(ano).slice(2)}`;
}

/** Nome do bairro como link para a ficha: destino e parâmetros do roteador. */
export const paraFicha = (id: string) => ({ to: "/bairros/$id" as const, params: { id } });
