/** Detecção automática de árvores (satélite e vídeo de rua): rótulos únicos para a interface. */

/** Sensor da detecção: o que o selo "via ..." diz (valor do campo `deteccao` da árvore). */
export const ROTULOS_SENSOR_DETECCAO = {
  satelite: "Via satélite",
  video_rua: "Via vídeo de rua",
} as const;
export type SensorDeteccao = keyof typeof ROTULOS_SENSOR_DETECCAO;

/** Faixas do selo de confiança (limiares em settings: baixa < 0,5 ≤ média < 0,8 ≤ alta). */
export const ROTULOS_FAIXA_CONFIANCA = {
  baixa: "Confiança baixa",
  media: "Confiança média",
  alta: "Confiança alta",
} as const;
export type FaixaConfianca = keyof typeof ROTULOS_FAIXA_CONFIANCA;

export const ROTULOS_SITUACAO_LOTE_DETECCAO = {
  recebido: "Recebido",
  em_processamento: "Em processamento",
  concluido: "Concluído",
  falhou: "Interrompido por erro",
} as const;

export const ROTULOS_CANAL_LOTE_DETECCAO = {
  api: "API",
  pacote: "Pacote (ZIP)",
} as const;

/** Resultado de cada detecção do lote (cores e rótulos do mapa do lote). */
export const ROTULOS_RESULTADO_DETECCAO = {
  criada: "Árvore criada",
  juntada: "Juntada a árvore existente",
  ponto_plantio: "Ponto de plantio possível",
  recusada: "Recusada",
  possivel_remocao: "Possível remoção",
} as const;
export type ResultadoDeteccao = keyof typeof ROTULOS_RESULTADO_DETECCAO;

export const ROTULOS_TIPO_PONTO_PLANTIO = {
  berco_vazio: "Berço vazio",
  toco: "Toco",
} as const;

export const ROTULOS_SITUACAO_SINAL_REMOCAO = {
  pendente: "Para revisar",
  remocao_confirmada: "Remoção confirmada",
  descartado: "Descartado",
} as const;

/** Qual contagem de árvores alimenta os indicadores (parâmetro `contagem` da API e da URL). */
export const ROTULOS_CONTAGEM = {
  todas: "Todas as árvores",
  confirmadas: "Só as confirmadas",
} as const;
export type Contagem = keyof typeof ROTULOS_CONTAGEM;

/** "1.234 árvores (567 confirmadas)": a forma única de mostrar as duas contagens. */
export function rotuloContagem(total: number, confirmadas: number): string {
  const f = (n: number) => n.toLocaleString("pt-BR");
  return `${f(total)} ${total === 1 ? "árvore" : "árvores"} (${f(confirmadas)} ${confirmadas === 1 ? "confirmada" : "confirmadas"})`;
}
