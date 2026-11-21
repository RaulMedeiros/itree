import {
  INDICADORES_POPULACAO,
  formatarIndicadorPopulacao,
  type IndicadorPopulacao,
} from "./coropletica";

/** Proveniência de um indicador da camada, como a API a devolve. */
export interface ProvenienciaPopulacao {
  fonte: string;
  fonte_url?: string;
  licenca?: string;
  data_referencia?: string | null;
  ingerido_em?: string;
  versao?: string;
  definicao: string;
  metodo?: string;
}

export interface IndicadorDaCamada {
  id: IndicadorPopulacao;
  nome: string;
  unidade: string;
  provisorio: boolean;
  ressalva: string;
  aviso: string;
  quebras: number[];
  bairros_com_dado: number;
  proveniencia: ProvenienciaPopulacao | null;
}

export interface DadosPopulacao {
  indicadores: IndicadorDaCamada[];
  estimativa: {
    ano: number | null;
    populacao: number;
    versao: string;
    hipotese: string;
  } | null;
}

/** Propriedades de cada bairro na camada. */
export interface BairroPopulacao {
  id?: string;
  nome?: string;
  densidade?: number | null;
  arvores_por_mil?: number | null;
  renda?: number | null;
  idh?: number | null;
  populacao?: number | null;
  arvores?: number | null;
  estimada?: number | null;
}

export const PROPRIEDADE: Record<IndicadorPopulacao, keyof BairroPopulacao> = {
  densidade: "densidade",
  arvores_por_mil: "arvores_por_mil",
  renda: "renda",
  idh: "idh",
};

export function textoEstimativa(
  estimada: number | null | undefined,
  dados: DadosPopulacao | null,
): string {
  if (!estimada) return "";
  const ano = dados?.estimativa?.ano ? ` para ${dados.estimativa.ano}` : "";
  return `Estimativa iTree${ano}: cerca de ${estimada.toLocaleString("pt-BR")} pessoas (não é dado oficial; supõe crescimento uniforme entre os bairros).`;
}

/** Dica do bairro sob o cursor: o valor do indicador escolhido, ou "sem dado" (nunca zero). */
export function textoDicaPopulacao(p: BairroPopulacao, escolhido: IndicadorPopulacao): string {
  const valor = p[PROPRIEDADE[escolhido]] as number | null | undefined;
  const nome = INDICADORES_POPULACAO.find((i) => i.id === escolhido)?.rotulo ?? "";
  if (valor === null || valor === undefined) return `${p.nome ?? "Bairro"} · sem dado: ${nome}`;
  return `${p.nome} · ${nome}: ${formatarIndicadorPopulacao(escolhido, Number(valor))}${
    escolhido === "idh" ? " (2010)" : ""
  }`;
}
