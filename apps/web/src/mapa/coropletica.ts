/**
 * Camada coroplética "Arborização do entorno (Censo 2022)" (contexto, fonte externa).
 *
 * Pinta cada bairro pelo percentual de faces de quadra com ao menos uma árvore
 * (`IndicadorTerritorialExterno`, IBGE). É percepção do recenseador sobre a face,
 * não cobertura de copa nem condição das árvores: por isso a cor é um único matiz
 * (azul), que não compete com o verde e o laranja da condição aparente das árvores.
 *
 * Quebras fixas, em pontos percentuais (limite inferior inclusivo): 40, 50, 60 e 70.
 * São fixas de propósito: o mesmo valor tem sempre a mesma cor, em qualquer escopo,
 * bairro filtrado ou data de importação, e dois mapas podem ser comparados. Quantis
 * mudariam de cor a cada importação. Os valores foram escolhidos pela distribuição
 * real de Fortaleza no Censo 2022 (121 bairros, de 27,9% a 91,2%; quintis 42,6, 47,6,
 * 53,6 e 60,9%): com 20/40/60/80, 81 bairros caíam na mesma classe.
 *
 * Paleta: rampa sequencial de um só matiz (passos 100, 250, 400, 550 e 700 da rampa azul
 * do guia de visualização de dados), do claro ao escuro. Contraste contra o mapa base e
 * entre classes verificado por `packages/ui-tokens/scripts/contraste.mjs`.
 */
import type { ExpressionSpecification } from "maplibre-gl";

export const QUEBRAS_ARBORIZACAO = [40, 50, 60, 70] as const;

export const CORES_ARBORIZACAO = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"] as const;
export const OPACIDADE_ARBORIZACAO = 0.75;

/** Bairro sem dado do Censo: cinza neutro com hachura (ver `registrarHachuraSemDado`). */
export const COR_SEM_DADO = "#a3ada7";

export const ROTULOS_CLASSES_ARBORIZACAO = [
  "Menos de 40%",
  "40% a menos de 50%",
  "50% a menos de 60%",
  "60% a menos de 70%",
  "70% ou mais",
] as const;

export const FONTE_ARBORIZACAO = "arborizacao-entorno";
export const CAMADAS_ARBORIZACAO = [
  "arborizacao-entorno-preenchimento",
  "arborizacao-entorno-sem-dado",
  "arborizacao-entorno-contorno",
];
export const IMAGEM_SEM_DADO = "hachura-sem-dado";

/** Classe (0 a 4) de um percentual; `null` sem dado (nunca zero). */
export function classeArborizacao(valor: number | null | undefined): number | null {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return null;
  return QUEBRAS_ARBORIZACAO.filter((q) => valor >= q).length;
}

/** Cor do preenchimento pelo `valor` da feição; bairro sem valor fica de fora (camada própria). */
export const COR_POR_VALOR: ExpressionSpecification = [
  "step",
  ["get", "valor"],
  CORES_ARBORIZACAO[0],
  QUEBRAS_ARBORIZACAO[0],
  CORES_ARBORIZACAO[1],
  QUEBRAS_ARBORIZACAO[1],
  CORES_ARBORIZACAO[2],
  QUEBRAS_ARBORIZACAO[2],
  CORES_ARBORIZACAO[3],
  QUEBRAS_ARBORIZACAO[3],
  CORES_ARBORIZACAO[4],
] as ExpressionSpecification;

export const FILTRO_COM_DADO: ExpressionSpecification = [
  "!=",
  ["typeof", ["get", "valor"]],
  "null",
];
export const FILTRO_SEM_DADO: ExpressionSpecification = [
  "==",
  ["typeof", ["get", "valor"]],
  "null",
];

/** Hachura diagonal cinza (RF de honestidade visual: sem dado não é "zero"). */
export function registrarHachuraSemDado(m: {
  hasImage: (id: string) => boolean;
  addImage: (id: string, imagem: ImageData, opcoes?: { pixelRatio?: number }) => void;
}): void {
  if (m.hasImage(IMAGEM_SEM_DADO)) return;
  const lado = 16;
  const tela = document.createElement("canvas");
  tela.width = tela.height = lado;
  const c = tela.getContext("2d");
  if (!c) return;
  c.strokeStyle = COR_SEM_DADO;
  c.lineWidth = 2;
  for (const d of [-lado, 0, lado]) {
    c.beginPath();
    c.moveTo(d, lado);
    c.lineTo(d + lado, 0);
    c.stroke();
  }
  m.addImage(IMAGEM_SEM_DADO, c.getImageData(0, 0, lado, lado), { pixelRatio: 2 });
}

// --- População, renda e IDH por bairro -------------------------------------------------------

/**
 * Camada "População e renda por bairro" (grupo Contexto, desligada por padrão), com um seletor:
 * densidade populacional, árvores cadastradas por 1.000 habitantes (provisório, DP-14), rendimento
 * médio do responsável (Censo 2022) e IDH 2010.
 *
 * As classes vêm da distribuição real: as quebras são quantis calculados pela API sobre todos os
 * bairros de Fortaleza (e não sobre o escopo, para o mesmo valor ter sempre a mesma cor). Valores
 * repetidos nos limites fundem classes, nunca criam classe vazia. Um só matiz (violeta), que não
 * compete com o azul do Censo, o verde da condição das árvores nem o laranja dos alertas; o
 * contraste é conferido por `packages/ui-tokens/scripts/contraste.mjs`.
 */
export const CORES_POPULACAO = ["#ece4f6", "#c3a6e2", "#9d77cc", "#6a3f9f", "#3a1c66"] as const;
export const OPACIDADE_POPULACAO = 0.75;

export const FONTE_POPULACAO = "populacao-bairros";
export const CAMADAS_POPULACAO = ["populacao-preenchimento", "populacao-sem-dado"];

export type IndicadorPopulacao = "densidade" | "arvores_por_mil" | "renda" | "idh";

export const INDICADORES_POPULACAO: {
  id: IndicadorPopulacao;
  rotulo: string;
  unidade: string;
  provisorio: boolean;
}[] = [
  { id: "densidade", rotulo: "Densidade populacional", unidade: "hab/km²", provisorio: false },
  {
    id: "arvores_por_mil",
    rotulo: "Árvores por 1.000 habitantes",
    unidade: "por 1.000 hab.",
    provisorio: true,
  },
  { id: "renda", rotulo: "Rendimento médio do responsável", unidade: "R$", provisorio: false },
  { id: "idh", rotulo: "IDH 2010", unidade: "IDH", provisorio: false },
];

export const ressalvaInventario =
  "Conta só as árvores cadastradas; enquanto o inventário não cobre o bairro, um valor baixo pode indicar falta de cadastro, não falta de árvores.";

/** Cores de `n` classes (2 a 5) tiradas da rampa, mantendo as pontas. */
export function coresDasClasses(n: number): string[] {
  const total = CORES_POPULACAO.length;
  if (n >= total) return [...CORES_POPULACAO];
  if (n <= 1) return [CORES_POPULACAO[Math.floor(total / 2)]!];
  return Array.from(
    { length: n },
    (_, i) => CORES_POPULACAO[Math.round((i * (total - 1)) / (n - 1))]!,
  );
}

/** Classe (0 a quebras.length) de um valor; `null` sem dado (nunca zero). */
export function classePorQuebras(
  valor: number | null | undefined,
  quebras: number[],
): number | null {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return null;
  return quebras.filter((q) => valor >= q).length;
}

/** Preenchimento por classe da propriedade da feição; o limite inferior de cada classe é inclusivo. */
export function corPorQuebras(propriedade: string, quebras: number[]): ExpressionSpecification {
  const cores = coresDasClasses(quebras.length + 1);
  const expressao: unknown[] = ["step", ["get", propriedade], cores[0]];
  quebras.forEach((q, i) => expressao.push(q, cores[i + 1]));
  return expressao as ExpressionSpecification;
}

export const filtroComDado = (propriedade: string): ExpressionSpecification => [
  "!=",
  ["typeof", ["get", propriedade]],
  "null",
];
export const filtroSemDado = (propriedade: string): ExpressionSpecification => [
  "==",
  ["typeof", ["get", propriedade]],
  "null",
];

/** Rótulos das classes ("Menos de X", "X a menos de Y", "Z ou mais"), com a unidade já formatada. */
export function rotulosDasClasses(quebras: number[], formatar: (v: number) => string): string[] {
  if (quebras.length === 0) return [];
  return [
    `Menos de ${formatar(quebras[0]!)}`,
    ...quebras.slice(1).map((q, i) => `${formatar(quebras[i]!)} a menos de ${formatar(q)}`),
    `${formatar(quebras.at(-1)!)} ou mais`,
  ];
}

/** Valor do indicador como a pessoa lê: "10.987 hab/km²", "R$ 4.192", "0,56" ou "0,09 por 1.000". */
export function formatarIndicadorPopulacao(id: IndicadorPopulacao, v: number): string {
  if (id === "densidade") return `${Math.round(v).toLocaleString("pt-BR")} hab/km²`;
  if (id === "renda") return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
  if (id === "idh")
    return v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} por 1.000 hab.`;
}
