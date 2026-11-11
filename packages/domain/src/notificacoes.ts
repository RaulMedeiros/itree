import type { TipoNotificacaoEnum } from "@itree/api-client";

/** Tipos de notificação como a pessoa os reconhece, no filtro da central. */
export const ROTULOS_TIPO_NOTIFICACAO: Record<TipoNotificacaoEnum, string> = {
  tarefa_atribuida: "Tarefa atribuída",
  tarefa_concluida: "Tarefa concluída",
  tarefa_bloqueada: "Tarefa bloqueada",
  risco_confirmado: "Risco confirmado",
  inspecao_devolvida: "Inspeção devolvida",
  inspecao_para_revisao: "Inspeção para revisão",
  alerta_novo: "Alerta ambiental novo",
};
