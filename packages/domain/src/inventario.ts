import type {
  EstadoEspecieEnum,
  EstadoLoteEnum,
  EstadoOcorrenciaEnum,
  MetodoMedidaEnum,
  OrigemLocalizacaoEnum,
  OrigemOcorrenciaEnum,
  OrigemRegistroEnum,
  OrigemValorEnum,
  PrioridadeEnum,
  SituacaoArvoreEnum,
  TipoMedidaEnum,
} from "@itree/api-client";

export const ROTULOS_ESTADO_ESPECIE: Record<EstadoEspecieEnum, string> = {
  confirmada: "Confirmada",
  sugerida_ia: "Sugerida (IA)",
  informada: "Informada (não validada)",
  nao_identificada: "Não identificada",
};

/** Origem da localização (RN-MAPA-002): símbolos distintos no mapa. */
export const ROTULOS_ORIGEM_LOCALIZACAO: Record<OrigemLocalizacaoEnum, string> = {
  gps_campo: "GPS de campo",
  importada: "Importada",
  estimada_web: "Estimada (web)",
  geocodificada: "Geocodificada (endereço)",
};

/** Classes de origem de valor (T-01 §2). */
export const ROTULOS_ORIGEM_VALOR: Record<OrigemValorEnum, string> = {
  medido: "Medido",
  estimado: "Estimado",
  inferido: "Inferido (IA)",
  importado: "Importado",
};

export const ROTULOS_TIPO_MEDIDA: Record<TipoMedidaEnum, string> = {
  altura: "Altura total",
  dap: "DAP",
  cap: "CAP",
  diametro_copa: "Diâmetro da copa",
  altura_bifurcacao: "Altura da 1ª bifurcação",
};

export const UNIDADES_MEDIDA: Record<TipoMedidaEnum, string> = {
  altura: "m",
  dap: "cm",
  cap: "cm",
  diametro_copa: "m",
  altura_bifurcacao: "m",
};

export const ROTULOS_METODO_MEDIDA: Record<MetodoMedidaEnum, string> = {
  fita_diametrica: "Fita diamétrica",
  fita_metrica: "Fita métrica",
  trena: "Trena",
  hipsometro: "Hipsômetro",
  clinometro: "Clinômetro",
  visual: "Estimativa visual",
  imagem: "Estimativa por imagem",
  desconhecido: "Não informado pela fonte",
};

export const ROTULOS_SITUACAO_ARVORE: Record<SituacaoArvoreEnum, string> = {
  ativa: "Ativa",
  excluida: "Excluída",
  fundida: "Fundida em outro registro",
};

export const ROTULOS_ORIGEM_REGISTRO: Record<OrigemRegistroEnum, string> = {
  web: "Painel web",
  app: "Aplicativo",
  importacao: "Importação",
};

export const ROTULOS_ESTADO_LOTE: Record<EstadoLoteEnum, string> = {
  pre_visualizado: "Pré-visualizado",
  confirmado: "Confirmado",
  desfeito: "Desfeito",
  descartado: "Descartado",
};

export const ROTULOS_ESTADO_OCORRENCIA: Record<EstadoOcorrenciaEnum, string> = {
  aberta: "Aberta",
  em_triagem: "Em triagem",
  encaminhada: "Encaminhada",
  em_atendimento: "Em atendimento",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

/** Verbo para o botão que leva a cada estado. */
export const ACOES_ESTADO_OCORRENCIA: Record<EstadoOcorrenciaEnum, string> = {
  aberta: "Reabrir",
  em_triagem: "Iniciar triagem",
  encaminhada: "Encaminhar",
  em_atendimento: "Iniciar atendimento",
  concluida: "Concluir",
  cancelada: "Cancelar",
};

export const ROTULOS_PRIORIDADE: Record<PrioridadeEnum, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
};

export const ROTULOS_ORIGEM_OCORRENCIA: Record<OrigemOcorrenciaEnum, string> = {
  web: "Painel web",
  app: "Aplicativo",
  importacao: "Importação",
  alerta: "Alerta ambiental convertido",
};
