import type {
  DecisaoIaEnum,
  FonteAlertaEnum,
  StatusAlertaEnum,
  TipoAlertaEnum,
} from "@itree/api-client";

export const ROTULOS_FONTE_ALERTA: Record<FonteAlertaEnum, string> = {
  inpe_focos: "INPE — BDQueimadas (focos de calor)",
  inpe_deter: "INPE — TerraBrasilis/DETER",
  mapbiomas: "MapBiomas Alerta",
};

export const ROTULOS_TIPO_ALERTA: Record<TipoAlertaEnum, string> = {
  foco_calor: "Foco de calor",
  supressao: "Alteração/supressão de vegetação",
};

/** Vocabulário da especificação (§7.5): nenhum status afirma infração antes da autoridade. */
export const ROTULOS_STATUS_ALERTA: Record<StatusAlertaEnum, string> = {
  detectado: "Alerta detectado",
  em_triagem: "Em triagem",
  requer_verificacao: "Requer verificação",
  compativel_autorizacao: "Compatível com autorização localizada",
  encaminhado: "Encaminhado à fiscalização",
  confirmado: "Confirmado pela autoridade",
  descartado: "Descartado",
};

export const ACOES_STATUS_ALERTA: Record<StatusAlertaEnum, string> = {
  detectado: "Voltar para detectado",
  em_triagem: "Iniciar triagem",
  requer_verificacao: "Requer verificação",
  compativel_autorizacao: "Compatível com autorização",
  encaminhado: "Encaminhar à fiscalização",
  confirmado: "Registrar confirmação da autoridade",
  descartado: "Descartar",
};

export const ROTULOS_DECISAO_IA: Record<DecisaoIaEnum, string> = {
  pendente: "Aguardando revisão",
  aceita: "Aceita",
  rejeitada: "Rejeitada",
};
