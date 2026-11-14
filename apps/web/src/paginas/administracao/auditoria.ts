import type { EventoAuditoria } from "@itree/api-client";

/**
 * Nome do modelo sem o app nem o sufixo "Event": "contas.Usuario" e "contas.UsuarioEvent" viram
 * "Usuario". A API manda o modelo rastreado ("contas.Usuario"); comparar com o nome do evento
 * deixava "Registro: —" em todas as linhas de usuário (R2-18).
 */
export function nomeDoModelo(entidadeModelo: string | null | undefined): string {
  const nome = (entidadeModelo ?? "").split(".").pop() ?? "";
  return nome.replace(/Event$/, "");
}

/**
 * Usuário afetado por um evento de usuário (nome, ou e-mail se não houver nome), para a coluna
 * "Registro" da auditoria dizer "quem". Para escopo e membro de equipe vale o `usuario_id`.
 */
export function usuarioAfetado(ev: EventoAuditoria, nomes?: Map<string, string>): string | null {
  const dados = (ev.dados ?? {}) as Record<string, unknown>;
  if (nomeDoModelo(ev.entidade_modelo) === "Usuario") {
    const rotulo = String(dados.nome || dados.email || "").trim();
    return rotulo || null;
  }
  const modelo = nomeDoModelo(ev.entidade_modelo);
  if (modelo === "EscopoUsuario" || modelo === "MembroEquipe") {
    const id = dados.usuario_id;
    return typeof id === "string" ? (nomes?.get(id) ?? null) : null;
  }
  return null;
}
