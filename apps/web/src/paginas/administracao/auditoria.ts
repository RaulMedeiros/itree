import type { EventoAuditoria } from "@itree/api-client";

import type { ContextoEvento } from "../../componentes/Historico";

/**
 * Eventos seguidos e iguais (mesma entidade, ação, autor, minuto e registro pai) viram um lote.
 * O pai entra na chave: filhos de árvores ou inspeções diferentes nunca são juntados.
 */
export type ItemAuditoria = { eventos: EventoAuditoria[] };

export function agruparEventos(eventos: EventoAuditoria[]): ItemAuditoria[] {
  const chave = (ev: EventoAuditoria) => {
    const ctx = (ev.contexto ?? {}) as ContextoEvento;
    const pai = ev.pai as { tipo?: string; id?: string } | null;
    return [
      ev.entidade_modelo,
      pai ? `${pai.tipo ?? ""}:${pai.id ?? ""}` : "",
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

/**
 * Usuário afetado por um evento de usuário (nome, ou e-mail se não houver nome), para a coluna
 * "Registro" da auditoria dizer "quem". Para escopo e membro de equipe vale o `usuario_id`.
 */
export function usuarioAfetado(ev: EventoAuditoria, nomes?: Map<string, string>): string | null {
  const dados = (ev.dados ?? {}) as Record<string, unknown>;
  if (ev.entidade_modelo === "contas.UsuarioEvent") {
    const rotulo = String(dados.nome || dados.email || "").trim();
    return rotulo || null;
  }
  if (
    ev.entidade_modelo === "contas.EscopoUsuarioEvent" ||
    ev.entidade_modelo === "contas.MembroEquipeEvent"
  ) {
    const id = dados.usuario_id;
    return typeof id === "string" ? (nomes?.get(id) ?? null) : null;
  }
  return null;
}
