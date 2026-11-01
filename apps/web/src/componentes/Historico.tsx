import type { EventoAuditoria } from "@itree/api-client";
import { ROTULOS_ACAO_AUDITORIA, ROTULOS_ORIGEM } from "@itree/domain";
import { Fragment } from "react";

import { Carregando, Erro, Vazio } from "../ui/estados";
import { Selo } from "../ui/selo";
import { formatarDataHora } from "../util/formatos";

export interface ContextoEvento {
  user?: string | null;
  origem?: string;
  motivo?: string | null;
  url?: string;
  evento?: string;
}

const EVENTOS: Record<string, string> = {
  vinculo_oidc: "Primeiro acesso (provedor de login)",
  importacao_territorios: "Importação de territórios",
  criar_administrador: "Comando criar_administrador",
  importacao_inventario: "Importação de inventário",
  desfazer_importacao: "Desfazer importação",
  fusao_arvores: "Fusão de registros",
};

export function autorDoEvento(
  ctx: ContextoEvento,
  nomes?: Map<string, string>,
  autorNome?: string | null,
): string {
  if (autorNome) return autorNome;
  if (ctx.user) return nomes?.get(ctx.user) ?? `Usuário ${ctx.user.slice(0, 8)}…`;
  if (ctx.evento && EVENTOS[ctx.evento]) return EVENTOS[ctx.evento]!;
  return "Sistema";
}

const OCULTOS = new Set(["criado_em", "atualizado_em", "geom", "id", "numero"]);
const DATA_HORA_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Campos *_id são referências internas: mostram só que mudaram. */
const ehReferencia = (campo: string) => campo.endsWith("_id");

function exibir(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(vazio)";
  if (typeof v === "string" && DATA_HORA_ISO.test(v)) return formatarDataHora(v) ?? v;
  if (Array.isArray(v)) {
    if (!v.length) return "(vazio)";
    return v
      .map((item) =>
        item && typeof item === "object"
          ? String((item as { nome?: unknown }).nome ?? JSON.stringify(item))
          : String(item),
      )
      .join(", ");
  }
  if (typeof v === "boolean") return v ? "sim" : "não";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function DetalhesEvento({ evento }: { evento: EventoAuditoria }) {
  const diferencas = evento.diferencas as Record<string, [unknown, unknown]> | null;
  const dados = (evento.dados ?? {}) as Record<string, unknown>;

  if (evento.acao === "alteracao" && diferencas && Object.keys(diferencas).length > 0) {
    const linhas = Object.entries(diferencas).filter(([campo]) => !OCULTOS.has(campo));
    if (diferencas.geom) linhas.unshift(["localização", ["(anterior)", "(nova)"]]);
    return (
      <table className="text-sm">
        <thead>
          <tr className="text-left text-xs text-texto-suave">
            <th className="pr-6 pb-1 font-medium">Campo</th>
            <th className="pr-6 pb-1 font-medium">Antes</th>
            <th className="pb-1 font-medium">Depois</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(([campo, [antes, depois]]) => (
            <tr key={campo}>
              <td className="pr-6 font-mono text-xs">{campo}</td>
              <td className="pr-6 text-perigo line-through">
                {ehReferencia(campo) ? (antes ? "(referência)" : "(vazio)") : exibir(antes)}
              </td>
              <td className="text-sucesso">
                {ehReferencia(campo) ? (depois ? "(nova referência)" : "(vazio)") : exibir(depois)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-0.5 text-sm">
      {Object.entries(dados)
        .filter(
          ([campo, valor]) =>
            !OCULTOS.has(campo) && !ehReferencia(campo) && valor !== null && valor !== "",
        )
        .map(([campo, valor]) => (
          <Fragment key={campo}>
            <dt className="font-mono text-xs text-texto-suave">{campo}</dt>
            <dd className="break-all">{exibir(valor)}</dd>
          </Fragment>
        ))}
    </dl>
  );
}

/** Linha do tempo com autor, origem, justificativa e diferenças (RF-INV-003, RF-OCO-005). */
export function LinhaDoTempo({
  eventos,
  carregando,
  erro,
}: {
  eventos?: EventoAuditoria[];
  carregando: boolean;
  erro?: unknown;
}) {
  if (carregando) return <Carregando linhas={3} />;
  if (erro) return <Erro erro={erro} />;
  if (!eventos?.length) return <Vazio titulo="Sem histórico registrado" />;
  return (
    <ol className="relative flex flex-col gap-4 border-l border-borda pl-5">
      {eventos.map((ev) => {
        const ctx = (ev.contexto ?? {}) as ContextoEvento;
        return (
          <li key={ev.id} className="relative">
            <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-superficie bg-marca" />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{ev.entidade}</span>
              <Selo
                tom={ev.acao === "exclusao" ? "perigo" : ev.acao === "criacao" ? "marca" : "info"}
              >
                {ROTULOS_ACAO_AUDITORIA[ev.acao] ?? ev.acao}
              </Selo>
              <span className="text-texto-suave">
                {formatarDataHora(ev.momento)} · {autorDoEvento(ctx, undefined, ev.autor_nome)}
                {ctx.origem ? ` · ${ROTULOS_ORIGEM[ctx.origem] ?? ctx.origem}` : ""}
              </span>
            </div>
            {ctx.motivo && <p className="mt-1 text-sm">Justificativa: {ctx.motivo}</p>}
            <div className="mt-1.5 rounded-md bg-fundo px-3 py-2">
              <DetalhesEvento evento={ev} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
