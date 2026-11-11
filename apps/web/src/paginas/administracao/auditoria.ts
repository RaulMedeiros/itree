import type { EventoAuditoria } from "@itree/api-client";

import type { ContextoEvento } from "../../componentes/Historico";

/** Eventos seguidos e iguais (mesma entidade, ação, autor e minuto) viram um lote. */
export type ItemAuditoria = { eventos: EventoAuditoria[] };

export function agruparEventos(eventos: EventoAuditoria[]): ItemAuditoria[] {
  const chave = (ev: EventoAuditoria) => {
    const ctx = (ev.contexto ?? {}) as ContextoEvento;
    return [
      ev.entidade_modelo,
      ev.acao,
      ctx.user ?? ctx.evento ?? "",
      ctx.origem ?? "",
      ctx.motivo ?? "",
      ev.momento.slice(0, 16),
    ].join("|");
  };
  const itens: ItemAuditoria[] = [];
  let ultima = "";
  for (const ev of eventos) {
    const k = chave(ev);
    const anterior = itens[itens.length - 1];
    if (anterior && k === ultima) anterior.eventos.push(ev);
    else itens.push({ eventos: [ev] });
    ultima = k;
  }
  return itens;
}
