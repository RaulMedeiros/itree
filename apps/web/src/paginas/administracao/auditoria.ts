import type { EventoAuditoria } from "@itree/api-client";

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
