import { useAuditoriaListar, type EventoAuditoria } from "@itree/api-client";
import { ROTULOS_ACAO_AUDITORIA, ROTULOS_ORIGEM } from "@itree/domain";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Fragment, useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { Botao } from "../../ui/botao";
import { Entrada, Selecao } from "../../ui/campos";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarDataHora } from "../../util/formatos";
import { useOpcoesUsuario } from "./dados";

const TAMANHO = 50;

const ENTIDADES: Record<string, string> = {
  "contas.UsuarioEvent": "Usuário",
  "contas.EscopoUsuarioEvent": "Escopo de usuário",
  "contas.EquipeEvent": "Equipe",
  "contas.MembroEquipeEvent": "Membro de equipe",
  "contas.TerritorioEquipeEvent": "Território de equipe",
  "territorio.TerritorioEvent": "Território",
};

export interface BuscaAuditoria {
  entidade?: string;
  origem?: string;
  objeto?: string;
  desde?: string;
  ate?: string;
  pagina?: number;
}

interface Contexto {
  user?: string | null;
  origem?: string;
  motivo?: string | null;
  url?: string;
  evento?: string;
}

/** Converte AAAA-MM-DD (dia local em Fortaleza, UTC−3) em limites ISO. */
const inicioDoDia = (d?: string) => (d ? `${d}T00:00:00-03:00` : undefined);
const fimDoDia = (d?: string) => (d ? `${d}T23:59:59.999-03:00` : undefined);

export function AuditoriaPagina() {
  const filtros = useSearch({ from: "/autenticado/administracao/auditoria" });
  const navegar = useNavigate({ from: "/administracao/auditoria" });
  const { usuarios } = useOpcoesUsuario(usePermissao("admin.usuarios"));
  const nomes = new Map(usuarios.map((u) => [u.id, u.nome || u.email]));
  const [expandido, setExpandido] = useState<string | null>(null);

  const consulta = useAuditoriaListar({
    entidade: filtros.entidade,
    origem: filtros.origem,
    objeto: filtros.objeto,
    desde: inicioDoDia(filtros.desde),
    ate: fimDoDia(filtros.ate),
    pagina: filtros.pagina,
    tamanho: TAMANHO,
  });

  const filtrar = (parcial: Partial<BuscaAuditoria>) =>
    void navegar({ search: (s: BuscaAuditoria) => ({ ...s, ...parcial, pagina: undefined }) });

  return (
    <>
      <CabecalhoPagina
        titulo="Auditoria"
        descricao="Toda alteração em usuários, equipes e territórios, com autor, origem e justificativa. Os registros não podem ser alterados."
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Selecao
          aria-label="Entidade"
          value={filtros.entidade ?? ""}
          onChange={(e) => filtrar({ entidade: e.target.value || undefined })}
          className="max-w-56"
        >
          <option value="">Todas as entidades</option>
          {Object.entries(ENTIDADES).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Selecao>
        <Selecao
          aria-label="Origem"
          value={filtros.origem ?? ""}
          onChange={(e) => filtrar({ origem: e.target.value || undefined })}
          className="max-w-48"
        >
          <option value="">Todas as origens</option>
          {Object.entries(ROTULOS_ORIGEM).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Selecao>
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          De
          <Entrada
            type="date"
            value={filtros.desde ?? ""}
            onChange={(e) => filtrar({ desde: e.target.value || undefined })}
            className="w-40"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          até
          <Entrada
            type="date"
            value={filtros.ate ?? ""}
            onChange={(e) => filtrar({ ate: e.target.value || undefined })}
            className="w-40"
          />
        </label>
        {filtros.objeto && (
          <Botao
            variante="secundario"
            tamanho="pequeno"
            onClick={() => filtrar({ objeto: undefined })}
          >
            Objeto {filtros.objeto.slice(0, 8)}… <X />
          </Botao>
        )}
      </div>

      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.count === 0 ? (
        <Vazio titulo="Nenhum evento encontrado">Ajuste os filtros ou o período.</Vazio>
      ) : (
        <>
          <Tabela>
            <thead>
              <tr>
                <Th className="w-8" />
                <Th>Quando</Th>
                <Th>Entidade</Th>
                <Th>Ação</Th>
                <Th>Autor</Th>
                <Th>Origem</Th>
                <Th>Justificativa</Th>
              </tr>
            </thead>
            <tbody>
              {consulta.data.data.results.map((ev) => {
                const ctx = (ev.contexto ?? {}) as Contexto;
                const aberto = expandido === ev.id;
                return (
                  <Fragment key={ev.id}>
                    <Linha className="hover:bg-fundo">
                      <Td>
                        <button
                          aria-expanded={aberto}
                          aria-label={aberto ? "Ocultar detalhes" : "Ver detalhes"}
                          className="rounded p-0.5 hover:bg-neutro-clara"
                          onClick={() => setExpandido(aberto ? null : ev.id)}
                        >
                          {aberto ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                      </Td>
                      <Td className="whitespace-nowrap">{formatarDataHora(ev.momento)}</Td>
                      <Td>{ev.entidade}</Td>
                      <Td>
                        <Selo
                          tom={
                            ev.acao === "exclusao"
                              ? "perigo"
                              : ev.acao === "criacao"
                                ? "marca"
                                : "info"
                          }
                        >
                          {ROTULOS_ACAO_AUDITORIA[ev.acao] ?? ev.acao}
                        </Selo>
                      </Td>
                      <Td>{autor(ctx, nomes)}</Td>
                      <Td>{ctx.origem ? (ROTULOS_ORIGEM[ctx.origem] ?? ctx.origem) : "—"}</Td>
                      <Td className="max-w-64">
                        {ctx.motivo || <span className="text-texto-suave">—</span>}
                      </Td>
                    </Linha>
                    {aberto && (
                      <tr>
                        <td colSpan={7} className="border-b border-borda bg-fundo px-4 py-3">
                          <Detalhes evento={ev} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Tabela>
          <Paginacao
            pagina={filtros.pagina ?? 1}
            total={consulta.data.data.count}
            tamanho={TAMANHO}
            aoMudar={(pagina) =>
              void navegar({ search: (s: BuscaAuditoria) => ({ ...s, pagina }) })
            }
          />
        </>
      )}
    </>
  );
}

function autor(ctx: Contexto, nomes: Map<string, string>): string {
  if (ctx.user) return nomes.get(ctx.user) ?? `Usuário ${ctx.user.slice(0, 8)}…`;
  if (ctx.evento === "vinculo_oidc") return "Primeiro acesso (provedor de login)";
  if (ctx.evento === "importacao_territorios") return "Importação de territórios";
  if (ctx.evento === "criar_administrador") return "Comando criar_administrador";
  return "Sistema";
}

function exibir(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(vazio)";
  if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : "(vazio)";
  if (typeof v === "boolean") return v ? "sim" : "não";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function Detalhes({ evento }: { evento: EventoAuditoria }) {
  const diferencas = evento.diferencas as Record<string, [unknown, unknown]> | null;
  const dados = (evento.dados ?? {}) as Record<string, unknown>;
  const ocultos = new Set(["criado_em", "atualizado_em", "geom"]);

  if (evento.acao === "alteracao" && diferencas && Object.keys(diferencas).length > 0) {
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
          {Object.entries(diferencas)
            .filter(([campo]) => !ocultos.has(campo))
            .map(([campo, [antes, depois]]) => (
              <tr key={campo}>
                <td className="pr-6 font-mono text-xs">{campo}</td>
                <td className="pr-6 text-perigo line-through">{exibir(antes)}</td>
                <td className="text-sucesso">{exibir(depois)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    );
  }
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-0.5 text-sm">
      {Object.entries(dados)
        .filter(([campo]) => !ocultos.has(campo))
        .map(([campo, valor]) => (
          <Fragment key={campo}>
            <dt className="font-mono text-xs text-texto-suave">{campo}</dt>
            <dd className="break-all">{exibir(valor)}</dd>
          </Fragment>
        ))}
    </dl>
  );
}
