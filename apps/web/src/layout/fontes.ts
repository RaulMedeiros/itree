import { type Conector, type Ingestao } from "@itree/api-client";
import { ROTULOS_FONTE_ALERTA } from "@itree/domain";

/** Sem ingestão bem-sucedida há mais que isso, a fonte é tratada como desatualizada. */
export const LIMITE_DESATUALIZADA_HORAS = 48;

export interface ProblemaFonte {
  fonte: string;
  motivo: "indisponivel" | "desatualizada";
}

/**
 * Fontes externas com problema (RF-SHELL-006), a partir da última ingestão de cada uma:
 * falha = indisponível; sucesso antigo = desatualizada. Fonte que nunca foi consultada
 * não entra: ainda não há integração em uso.
 */
export function fontesComProblema(ingestoes: Ingestao[], agora = new Date()): ProblemaFonte[] {
  const ultima = new Map<string, Ingestao>();
  for (const i of ingestoes) {
    const atual = ultima.get(i.fonte);
    if (!atual || new Date(i.iniciada_em) > new Date(atual.iniciada_em)) ultima.set(i.fonte, i);
  }
  const limite = LIMITE_DESATUALIZADA_HORAS * 3600_000;
  const problemas: ProblemaFonte[] = [];
  for (const [fonte, i] of ultima) {
    const rotulo = ROTULOS_FONTE_ALERTA[fonte as keyof typeof ROTULOS_FONTE_ALERTA] ?? fonte;
    if (!i.sucesso) problemas.push({ fonte: rotulo, motivo: "indisponivel" });
    else if (agora.getTime() - new Date(i.iniciada_em).getTime() > limite)
      problemas.push({ fonte: rotulo, motivo: "desatualizada" });
  }
  return problemas;
}

/**
 * Conectores ativos com problema (RF-INT-006): a última sincronização falhou (indisponível) ou
 * passou de duas periodicidades sem rodar (desatualizada). Conector desativado não alerta.
 */
export function conectoresComProblema(conectores: Conector[]): ProblemaFonte[] {
  return conectores
    .filter((c) => c.ativo && (c.situacao === "falha" || c.situacao === "atrasado"))
    .map((c) => ({
      fonte: c.nome,
      motivo: c.situacao === "falha" ? ("indisponivel" as const) : ("desatualizada" as const),
    }));
}
