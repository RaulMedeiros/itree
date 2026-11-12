import type { EstadoTarefaEnum, Tarefa } from "@itree/api-client";
import { ACOES_ESTADO_TAREFA } from "@itree/domain";

/** Rótulo da ação de levar a tarefa a `estado`. Sair de "Bloqueada" é desbloquear, não iniciar. */
export function rotuloDaAcao(tarefa: Tarefa, estado: EstadoTarefaEnum): string {
  if (tarefa.estado === "bloqueada" && estado === "nao_iniciada") return "Desbloquear";
  return ACOES_ESTADO_TAREFA[estado];
}
