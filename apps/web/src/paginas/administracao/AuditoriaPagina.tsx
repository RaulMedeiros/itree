import { useAuditoriaListar, type EventoAuditoria } from "@itree/api-client";
import { ROTULOS_ACAO_AUDITORIA, ROTULOS_ORIGEM } from "@itree/domain";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { Fragment, useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { Botao } from "../../ui/botao";
import { Entrada, EntradaData, Selecao } from "../../ui/campos";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { formatarDataHora, plural } from "../../util/formatos";
import {
  DadosTecnicos,
  DetalhesEvento,
  autorDoEvento,
  type ContextoEvento,
} from "../../componentes/Historico";
import { classeCodigo } from "../../ui/codigo";
import { nomeDoModelo, usuarioAfetado } from "./auditoria";
import { useOpcoesUsuario } from "./dados";

const TAMANHO = 50;

const ENTIDADES: Record<string, string> = {
  "contas.UsuarioEvent": "Usuário",
  "contas.EscopoUsuarioEvent": "Escopo de usuário",
  "contas.EquipeEvent": "Equipe",
  "contas.MembroEquipeEvent": "Membro de equipe",
  "contas.TerritorioEquipeEvent": "Território de equipe",
  "territorio.TerritorioEvent": "Território",
  "inventario.EspecieEvent": "Espécie",
  "inventario.ArvoreEvent": "Árvore",
  "inventario.IdentificadorExternoEvent": "Identificador externo",
  "inventario.MedidaEvent": "Medida",
  "inventario.LoteImportacaoEvent": "Lote de importação",
  "inventario.ParNaoDuplicadoEvent": "Par revisado (não duplicado)",
  "ocorrencias.TipoOcorrenciaEvent": "Tipo de ocorrência",
  "ocorrencias.OcorrenciaEvent": "Ocorrência",
  "evidencias.EvidenciaEvent": "Evidência",
  "inspecoes.InspecaoEvent": "Inspeção",
  "tarefas.TarefaEvent": "Tarefa",
  "alertas.AlertaAmbientalEvent": "Alerta ambiental",
  "relatorios.ExportacaoEvent": "Exportação",
  "qualidade.InferenciaIAEvent": "Sugestão de IA",
};

const PLURAL_ACAO: Record<string, string> = {
  criacao: "criados",
  alteracao: "alterados",
  exclusao: "excluídos",
};

interface PaiEvento {
  tipo: "arvore" | "inspecao" | "ocorrencia" | "tarefa";
  id: string;
  codigo: string;
}

/** Código do registro afetado e o tipo/ID para o link: o próprio registro ou,
 * em medidas, evidências e sugestões de IA, o registro pai. */
function alvoDoRegistro(ev: EventoAuditoria) {
  const pai = ev.pai as PaiEvento | null;
  if (pai) return { codigo: pai.codigo, tipo: pai.tipo as string, id: pai.id, ehPai: true };
  if (!ev.registro) return null;
  const tipo = nomeDoModelo(ev.entidade_modelo).toLowerCase();
  return { codigo: ev.registro, tipo, id: ev.objeto_id ?? "", ehPai: false };
}

/** Link para o registro, quando existe uma tela de detalhe para ele. */
function Registro({ ev, nomes }: { ev: EventoAuditoria; nomes?: Map<string, string> }) {
  const alvo = alvoDoRegistro(ev);
  if (!alvo) {
    const usuario = usuarioAfetado(ev, nomes);
    if (!usuario) return <span className="text-texto-suave">—</span>;
    const ehUsuario = nomeDoModelo(ev.entidade_modelo) === "Usuario" && ev.objeto_id;
    return ehUsuario ? (
      <Link
        to="/administracao/usuarios/$id"
        params={{ id: ev.objeto_id! }}
        className="text-xs text-marca-escura hover:underline"
      >
        {usuario}
      </Link>
    ) : (
      <span className="text-xs">{usuario}</span>
    );
  }
  const classe = `${classeCodigo} text-xs hover:underline`;
  const { codigo, id } = alvo;
  const rotulo = alvo.ehPai ? (
    <>
      <span className="font-sans text-texto-suave">em </span>
      {codigo}
    </>
  ) : (
    codigo
  );
  switch (alvo.tipo) {
    case "arvore":
      return (
        <Link to="/inventario/arvores/$id" params={{ id }} className={classe}>
          {rotulo}
        </Link>
      );
    case "ocorrencia":
      return (
        <Link to="/ocorrencias/$id" params={{ id }} className={classe}>
          {rotulo}
        </Link>
      );
    case "inspecao":
      return (
        <Link to="/inspecoes/$id" params={{ id }} className={classe}>
          {rotulo}
        </Link>
      );
    case "tarefa":
      return (
        <Link to="/equipes-tarefas/$id" params={{ id }} className={classe}>
          {rotulo}
        </Link>
      );
    case "alertaambiental":
      return (
        <Link to="/alertas/$id" params={{ id }} className={classe}>
          {rotulo}
        </Link>
      );
    default:
      return <span className="font-mono text-xs">{codigo}</span>;
  }
}

export interface BuscaAuditoria {
  entidade?: string;
  origem?: string;
  objeto?: string;
  codigo?: string;
  desde?: string;
  ate?: string;
  pagina?: number;
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
  const [codigo, setCodigo] = useState(filtros.codigo ?? "");

  const consulta = useAuditoriaListar({
    entidade: filtros.entidade,
    origem: filtros.origem,
    objeto: filtros.objeto,
    codigo: filtros.codigo,
    desde: inicioDoDia(filtros.desde),
    ate: fimDoDia(filtros.ate),
    pagina: filtros.pagina,
    tamanho: TAMANHO,
  });

  // O servidor já devolve os eventos iguais agrupados e pagina por grupo.
  const grupos = consulta.data?.data.results ?? [];
  const eventosNaPagina = grupos.reduce((soma, g) => soma + g.quantidade, 0);

  const filtrar = (parcial: Partial<BuscaAuditoria>) =>
    void navegar({ search: (s: BuscaAuditoria) => ({ ...s, ...parcial, pagina: undefined }) });

  return (
    <>
      <CabecalhoPagina
        titulo="Auditoria"
        descricao="Toda alteração em usuários, equipes, territórios, árvores, ocorrências e demais registros, com autor, origem e justificativa. Eventos iguais do mesmo minuto aparecem agrupados numa linha. Os registros não podem ser alterados."
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
          <EntradaData
            value={filtros.desde ?? ""}
            onChange={(v) => filtrar({ desde: v || undefined })}
            className="w-40"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-texto-suave">
          até
          <EntradaData
            value={filtros.ate ?? ""}
            onChange={(v) => filtrar({ ate: v || undefined })}
            className="w-40"
          />
        </label>
        <form
          role="search"
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            filtrar({ codigo: codigo.trim() || undefined });
          }}
        >
          <Entrada
            type="search"
            aria-label="Buscar por código do registro"
            placeholder="Código (ex.: OCO-000014)"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            className="w-56"
          />
          <Botao type="submit" variante="secundario" tamanho="pequeno">
            <Search /> Buscar
          </Botao>
        </form>
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
                <Th>Registro</Th>
                <Th>Ação</Th>
                <Th>Autor</Th>
                <Th>Origem</Th>
                <Th>Justificativa</Th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((grupo) => {
                const { eventos, quantidade } = grupo;
                const ev = eventos[0]!;
                const lote = quantidade > 1;
                const ctx = (ev.contexto ?? {}) as ContextoEvento;
                const aberto = expandido === grupo.id;
                return (
                  <Fragment key={grupo.id}>
                    <Linha className="hover:bg-fundo">
                      <Td>
                        <button
                          aria-expanded={aberto}
                          aria-label={aberto ? "Ocultar detalhes" : "Ver detalhes"}
                          className="rounded p-0.5 hover:bg-neutro-clara"
                          onClick={() => setExpandido(aberto ? null : grupo.id)}
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
                        {lote ? (
                          <span className="text-texto-suave">
                            {quantidade} registros
                            {ev.pai ? (
                              <>
                                {" "}
                                <Registro ev={ev} />
                              </>
                            ) : null}
                          </span>
                        ) : (
                          <Registro ev={ev} nomes={nomes} />
                        )}
                      </Td>
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
                          {lote
                            ? `${quantidade} ${PLURAL_ACAO[ev.acao] ?? "eventos"}`
                            : (ROTULOS_ACAO_AUDITORIA[ev.acao] ?? ev.acao)}
                        </Selo>
                      </Td>
                      <Td>{autorDoEvento(ctx, nomes, ev.autor_nome)}</Td>
                      <Td>{ctx.origem ? (ROTULOS_ORIGEM[ctx.origem] ?? ctx.origem) : "—"}</Td>
                      <Td className="max-w-64">
                        {ctx.motivo || <span className="text-texto-suave">—</span>}
                      </Td>
                    </Linha>
                    {aberto && (
                      <tr>
                        <td colSpan={8} className="border-b border-borda bg-fundo px-4 py-3">
                          <div className="flex flex-col gap-3">
                            {grupo.truncado && (
                              <p className="text-xs text-texto-suave">
                                Mostrando os {eventos.length.toLocaleString("pt-BR")} eventos mais
                                recentes de {quantidade.toLocaleString("pt-BR")}. Filtre por período
                                ou por código para ver os demais.
                              </p>
                            )}
                            {eventos.map((e) => (
                              <div key={e.id}>
                                {lote && (
                                  <p className="mb-1 text-xs text-texto-suave">
                                    <Registro ev={e} />
                                  </p>
                                )}
                                <DetalhesEvento evento={e} />
                                <DadosTecnicos evento={e} />
                              </div>
                            ))}
                          </div>
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
            unidade="grupos de eventos"
            nota={
              eventosNaPagina > grupos.length
                ? `${plural(eventosNaPagina, "evento")} nesta página`
                : undefined
            }
            aoMudar={(pagina) =>
              void navegar({ search: (s: BuscaAuditoria) => ({ ...s, pagina }) })
            }
          />
        </>
      )}
    </>
  );
}
