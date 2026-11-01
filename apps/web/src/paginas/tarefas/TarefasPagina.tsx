import {
  ErroApi,
  EstadoTarefaEnum,
  TipoTarefaEnum,
  useEquipesListar,
  useTarefasAtualizar,
  useTarefasListar,
  useTarefasTransicao,
  type Tarefa,
} from "@itree/api-client";
import { ACOES_ESTADO_TAREFA, ROTULOS_ESTADO_TAREFA, ROTULOS_TIPO_TAREFA } from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { SeloEstadoTarefa } from "../../componentes/selos";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, Entrada, Selecao } from "../../ui/campos";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { invalidarCaminhos } from "../../util/cache";
import { formatarData } from "../../util/formatos";

const TAMANHO = 50;

export interface BuscaTarefas {
  responsavel?: "eu";
  estado?: string;
  tipo?: TipoTarefaEnum;
  equipe?: string;
  atrasadas?: "true";
  pagina?: number;
}

export function TarefasPagina() {
  const filtros = useSearch({ from: "/autenticado/equipes-tarefas" });
  const navegar = useNavigate({ from: "/equipes-tarefas" });
  const podeEditar = usePermissao("tarefas.editar");
  const equipes = useEquipesListar({ ativa: true, tamanho: 200 });
  const consulta = useTarefasListar({
    ...filtros,
    estado: filtros.estado ?? "abertas",
    atrasadas: filtros.atrasadas === "true" ? true : undefined,
    tamanho: TAMANHO,
  });
  const [transicao, setTransicao] = useState<{ tarefa: Tarefa; estado: EstadoTarefaEnum } | null>(
    null,
  );
  const [atribuindo, setAtribuindo] = useState<Tarefa | null>(null);
  const filtrar = (parcial: Partial<BuscaTarefas>) =>
    void navegar({ search: (s: BuscaTarefas) => ({ ...s, ...parcial, pagina: undefined }) });

  return (
    <div className="mx-auto max-w-7xl">
      <CabecalhoPagina
        titulo="Equipes e tarefas"
        descricao="Tarefas de campo por responsável, equipe e prazo. Crie tarefas de inspeção em lote a partir do inventário."
        acoes={
          podeEditar && (
            <Botao variante="secundario" asChild>
              <Link to="/inventario/arvores">Criar tarefas a partir do inventário</Link>
            </Botao>
          )
        }
      />
      {equipes.data && equipes.data.data.count > 0 && (
        <ul className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {equipes.data.data.results.map((e) => (
            <li key={e.id}>
              <button
                className={`w-full rounded-lg border bg-superficie p-3 text-left text-sm hover:border-marca ${filtros.equipe === e.id ? "border-marca" : "border-borda"}`}
                aria-pressed={filtros.equipe === e.id}
                onClick={() => filtrar({ equipe: filtros.equipe === e.id ? undefined : e.id })}
              >
                <p className="font-medium">{e.nome}</p>
                <p className="text-xs text-texto-suave">
                  {e.membros.length} membro(s) ·{" "}
                  {e.territorios.map((t) => t.nome).join(", ") || "sem território"}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Selecao
          aria-label="Responsável"
          value={filtros.responsavel ?? ""}
          onChange={(e) =>
            filtrar({ responsavel: (e.target.value || undefined) as "eu" | undefined })
          }
          className="max-w-48"
        >
          <option value="">Todas as tarefas</option>
          <option value="eu">Minhas tarefas</option>
        </Selecao>
        <Selecao
          aria-label="Situação"
          value={filtros.estado ?? "abertas"}
          onChange={(e) => filtrar({ estado: e.target.value })}
          className="max-w-48"
        >
          <option value="abertas">Em aberto</option>
          {Object.values(EstadoTarefaEnum).map((e) => (
            <option key={e} value={e}>
              {ROTULOS_ESTADO_TAREFA[e]}
            </option>
          ))}
          <option value="todas">Todas</option>
        </Selecao>
        <Selecao
          aria-label="Tipo"
          value={filtros.tipo ?? ""}
          onChange={(e) =>
            filtrar({ tipo: (e.target.value || undefined) as TipoTarefaEnum | undefined })
          }
          className="max-w-56"
        >
          <option value="">Todos os tipos</option>
          {Object.values(TipoTarefaEnum).map((t) => (
            <option key={t} value={t}>
              {ROTULOS_TIPO_TAREFA[t]}
            </option>
          ))}
        </Selecao>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-marca"
            checked={filtros.atrasadas === "true"}
            onChange={(e) => filtrar({ atrasadas: e.target.checked ? "true" : undefined })}
          />
          Só atrasadas
        </label>
      </div>
      {consulta.isPending ? (
        <Carregando />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : consulta.data.data.count === 0 ? (
        <Vazio titulo="Nenhuma tarefa encontrada" />
      ) : (
        <>
          <Tabela>
            <thead>
              <tr>
                <Th>Tarefa</Th>
                <Th>Alvo</Th>
                <Th>Responsável / equipe</Th>
                <Th>Prazo</Th>
                <Th>Situação</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {consulta.data.data.results.map((t) => (
                <Linha key={t.id}>
                  <Td>
                    <p className="font-mono font-medium">{t.codigo}</p>
                    <p className="text-xs text-texto-suave">{ROTULOS_TIPO_TAREFA[t.tipo]}</p>
                    {t.descricao && <p className="text-xs">{t.descricao}</p>}
                  </Td>
                  <Td>
                    {t.alvo.tipo === "arvore" ? (
                      <Link
                        to="/inventario/arvores/$id"
                        params={{ id: String(t.alvo.id) }}
                        className="font-mono text-marca-escura hover:underline"
                      >
                        {String(t.alvo.codigo)}
                      </Link>
                    ) : (
                      <Link
                        to="/ocorrencias/$id"
                        params={{ id: String(t.alvo.id) }}
                        className="font-mono text-marca-escura hover:underline"
                      >
                        {String(t.alvo.codigo)}
                      </Link>
                    )}
                  </Td>
                  <Td>
                    {t.responsavel ? (
                      t.responsavel.nome || t.responsavel.email
                    ) : (
                      <span className="text-texto-suave">Sem responsável</span>
                    )}
                    {t.equipe && <p className="text-xs text-texto-suave">{t.equipe.nome}</p>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatarData(t.prazo) ?? "—"}
                    {t.atrasada && (
                      <div>
                        <Selo tom="perigo">Atrasada</Selo>
                      </div>
                    )}
                  </Td>
                  <Td>
                    <SeloEstadoTarefa estado={t.estado ?? "nao_iniciada"} />
                    {t.motivo_estado && (
                      <p className="max-w-56 text-xs text-texto-suave">{t.motivo_estado}</p>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {t.transicoes_possiveis.map((e) => (
                        <Botao
                          key={e}
                          tamanho="pequeno"
                          variante={
                            e === "cancelada" || e === "bloqueada" ? "secundario" : "primario"
                          }
                          onClick={() => setTransicao({ tarefa: t, estado: e })}
                        >
                          {ACOES_ESTADO_TAREFA[e]}
                        </Botao>
                      ))}
                      {podeEditar && t.transicoes_possiveis.length > 0 && (
                        <Botao
                          tamanho="pequeno"
                          variante="fantasma"
                          onClick={() => setAtribuindo(t)}
                        >
                          Reatribuir
                        </Botao>
                      )}
                    </div>
                  </Td>
                </Linha>
              ))}
            </tbody>
          </Tabela>
          <Paginacao
            pagina={filtros.pagina ?? 1}
            total={consulta.data.data.count}
            tamanho={TAMANHO}
            aoMudar={(p) => void navegar({ search: (s: BuscaTarefas) => ({ ...s, pagina: p }) })}
          />
        </>
      )}
      {transicao && <TransicaoDialogo {...transicao} aoFechar={() => setTransicao(null)} />}
      {atribuindo && <ReatribuirDialogo tarefa={atribuindo} aoFechar={() => setAtribuindo(null)} />}
    </div>
  );
}

function TransicaoDialogo({
  tarefa,
  estado,
  aoFechar,
}: {
  tarefa: Tarefa;
  estado: EstadoTarefaEnum;
  aoFechar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const mutacao = useTarefasTransicao<ErroApi>();
  const cliente = useQueryClient();
  const exige = estado === "bloqueada" || estado === "cancelada";
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`${ACOES_ESTADO_TAREFA[estado]} ${tarefa.codigo}`}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao
            disabled={(exige && !motivo.trim()) || mutacao.isPending}
            onClick={() =>
              mutacao.mutate(
                { id: tarefa.id, data: { estado, motivo: motivo.trim() } },
                {
                  onSuccess: async () => (
                    await invalidarCaminhos(cliente, "/api/v1/tarefas"),
                    aoFechar()
                  ),
                },
              )
            }
          >
            Confirmar
          </Botao>
        </>
      }
    >
      {mutacao.error && (
        <p className="mb-3 text-sm text-perigo">
          {Object.values(mutacao.error.errosDeCampo).flat()[0] ?? mutacao.error.message}
        </p>
      )}
      <Campo rotulo={exige ? "Motivo" : "Observação (opcional)"} obrigatorio={exige}>
        {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Campo>
    </Dialogo>
  );
}

function ReatribuirDialogo({ tarefa, aoFechar }: { tarefa: Tarefa; aoFechar: () => void }) {
  const equipes = useEquipesListar({ ativa: true, tamanho: 200 });
  const [equipe, setEquipe] = useState(tarefa.equipe?.id ?? "");
  const [responsavel, setResponsavel] = useState(tarefa.responsavel?.id ?? "");
  const [prazo, setPrazo] = useState(tarefa.prazo ?? "");
  const [motivo, setMotivo] = useState("");
  const mutacao = useTarefasAtualizar<ErroApi>();
  const cliente = useQueryClient();
  const membros = equipes.data?.data.results.find((e) => e.id === equipe)?.membros ?? [
    ...new Map(
      (equipes.data?.data.results ?? []).flatMap((e) => e.membros).map((m) => [m.id, m]),
    ).values(),
  ];
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`Reatribuir ${tarefa.codigo}`}
      descricao="A reatribuição fica no histórico da tarefa com o motivo."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            disabled={!motivo.trim() || mutacao.isPending}
            onClick={() =>
              mutacao.mutate(
                {
                  id: tarefa.id,
                  data: {
                    equipe_id: equipe || null,
                    responsavel_id: responsavel || null,
                    prazo: prazo || null,
                    motivo: motivo.trim(),
                  },
                },
                {
                  onSuccess: async () => (
                    await invalidarCaminhos(cliente, "/api/v1/tarefas"),
                    aoFechar()
                  ),
                },
              )
            }
          >
            Salvar
          </Botao>
        </>
      }
    >
      {mutacao.error && (
        <p className="mb-3 text-sm text-perigo">
          {Object.values(mutacao.error.errosDeCampo).flat()[0] ?? mutacao.error.message}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Campo rotulo="Equipe">
          {(p) => (
            <Selecao {...p} value={equipe} onChange={(e) => setEquipe(e.target.value)}>
              <option value="">Sem equipe</option>
              {equipes.data?.data.results.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.nome}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo
          rotulo="Responsável"
          ajuda="O local da tarefa precisa estar no escopo territorial do responsável."
        >
          {(p) => (
            <Selecao {...p} value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
              <option value="">Sem responsável</option>
              {membros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome || m.email}
                </option>
              ))}
            </Selecao>
          )}
        </Campo>
        <Campo rotulo="Prazo">
          {(p) => (
            <Entrada {...p} type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          )}
        </Campo>
        <Campo rotulo="Motivo" obrigatorio>
          {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Campo>
      </div>
    </Dialogo>
  );
}
