import { contar } from "../../util/formatos";

/** Dias na fila de revisão a partir dos quais o aviso passa a chamar atenção (R3-31). */
export const ESPERA_ATENCAO_DIAS = 3;

/** Tempo na fila de revisão, em dias corridos. "Chegou hoje" só aparece para quem chegou hoje. */
export function aguardaHa(dias: number): string {
  if (dias <= 0) return "chegou hoje";
  return `aguarda há ${contar(dias, "dia", "dias")}`;
}

/** Chegar hoje ou ontem é o estado normal da fila: só a espera longa ganha a cor de atenção. */
export function esperaEmAtencao(dias: number): boolean {
  return dias >= ESPERA_ATENCAO_DIAS;
}
