import type {
  CondicaoAparenteEnum,
  EstadoInspecaoEnum,
  EstadoTarefaEnum,
  OrigemInspecaoEnum,
  SinalObservadoEnum,
  TipoTarefaEnum,
} from "@itree/api-client";

export const ROTULOS_ESTADO_INSPECAO: Record<EstadoInspecaoEnum, string> = {
  rascunho: "Rascunho",
  em_revisao: "Em revisão",
  devolvida: "Devolvida para correção",
  validada: "Validada",
};

/** Escala provisória até o protocolo técnico (DP-03). */
export const ROTULOS_CONDICAO: Record<CondicaoAparenteEnum, string> = {
  boa: "Boa",
  regular: "Regular",
  ruim: "Ruim",
  morta: "Aparentemente morta",
  nao_avaliada: "Não avaliada",
};

/** Sinais apontados em campo: “sinal visual possível”, nunca diagnóstico. */
export const ROTULOS_SINAL: Record<SinalObservadoEnum, string> = {
  folhagem_escassa: "Folhagem escassa",
  descoloracao: "Descoloração da folhagem",
  ferida: "Ferida ou dano visível no tronco",
  fungos: "Presença aparente de fungos",
  cavidade: "Cavidade ou oco aparente",
  inclinacao: "Inclinação perceptível",
  galhos_secos: "Galhos secos",
  galhos_quebrados: "Galhos quebrados ou pendurados",
  raiz_exposta: "Raízes expostas ou danificadas",
  conflito_rede: "Conflito com rede aérea",
  conflito_calcada: "Conflito com calçada ou edificação",
  pragas: "Presença aparente de pragas",
};

export const ROTULOS_ORIGEM_INSPECAO: Record<OrigemInspecaoEnum, string> = {
  app: "Aplicativo de campo",
  web: "Painel web (contingência)",
};

export const ROTULOS_TIPO_TAREFA: Record<TipoTarefaEnum, string> = {
  inspecao_arvore: "Inspeção de árvore",
  atendimento_ocorrencia: "Atendimento de ocorrência",
};

export const ROTULOS_ESTADO_TAREFA: Record<EstadoTarefaEnum, string> = {
  nao_iniciada: "Não iniciada",
  em_execucao: "Em execução",
  concluida: "Concluída",
  bloqueada: "Bloqueada",
  cancelada: "Cancelada",
};

export const ACOES_ESTADO_TAREFA: Record<EstadoTarefaEnum, string> = {
  nao_iniciada: "Voltar para não iniciada",
  em_execucao: "Iniciar",
  concluida: "Concluir",
  bloqueada: "Marcar como bloqueada",
  cancelada: "Cancelar",
};
