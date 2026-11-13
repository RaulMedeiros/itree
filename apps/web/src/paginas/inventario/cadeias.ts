import type { InspecaoResumo, Ocorrencia } from "@itree/api-client";

/** A inspeção que abre a cadeia. Quando só se conhece o vínculo da ocorrência, vem sem estado e data. */
export type InspecaoDaCadeia = Pick<InspecaoResumo, "id" | "codigo"> &
  Partial<
    Pick<InspecaoResumo, "estado" | "realizada_em" | "condicao_aparente" | "tecnico" | "tarefa">
  > & {
    requer_encaminhamento?: boolean;
  };

/** Um encadeamento (M-21, M-28): a tarefa de inspeção, a inspeção, as ocorrências que ela gerou e as tarefas de cada uma. */
export interface Cadeia {
  chave: string;
  /** Início da cadeia, para a linha do tempo (a inspeção ou, sem ela, a primeira ocorrência). */
  inicio: string;
  /** Nulo quando a ocorrência não veio de uma inspeção (registro direto, alerta). */
  inspecao: InspecaoDaCadeia | null;
  ocorrencias: Ocorrencia[];
}

const porData = (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime();

/**
 * Agrupa as inspeções e ocorrências de uma árvore em cadeias, da mais recente para a mais antiga.
 * Toda inspeção abre uma cadeia (mesmo sem desdobramentos); a ocorrência entra na cadeia da
 * inspeção que a originou e, sem ela, forma uma cadeia própria. As tarefas já vêm na ocorrência.
 */
export function montarCadeias(
  inspecoes: readonly InspecaoResumo[],
  ocorrencias: readonly Ocorrencia[],
): Cadeia[] {
  const cadeias = new Map<string, Cadeia>();
  for (const i of inspecoes) {
    cadeias.set(i.id, { chave: i.id, inicio: i.realizada_em, inspecao: i, ocorrencias: [] });
  }
  const avulsas: Cadeia[] = [];
  for (const o of [...ocorrencias].sort((a, b) => porData(a.criado_em, b.criado_em))) {
    const origem = o.origem_vinculo?.tipo === "inspecao" ? o.origem_vinculo : null;
    if (!origem) {
      avulsas.push({ chave: o.id, inicio: o.criado_em, inspecao: null, ocorrencias: [o] });
      continue;
    }
    // A inspeção pode estar fora da lista (sem permissão ou além do limite): vale o vínculo.
    const cadeia = cadeias.get(origem.id) ?? {
      chave: origem.id,
      inicio: o.criado_em,
      inspecao: { id: origem.id, codigo: origem.codigo },
      ocorrencias: [],
    };
    cadeia.ocorrencias.push(o);
    cadeias.set(origem.id, cadeia);
  }
  return [...cadeias.values(), ...avulsas].sort((a, b) => porData(b.inicio, a.inicio));
}
