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
import { ROTULOS_ESTADO_TAREFA, ROTULOS_TIPO_TAREFA } from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { BotaoExportarCsv } from "../../componentes/BotaoExportarCsv";
import { filtrosParaExportar } from "../../componentes/filtrosExportacao";
import { AvisoEquipeIncompleta } from "../../componentes/AvisoEquipeIncompleta";
import { BarraAcoesEmLote, CaixaDaPagina } from "../../componentes/lote";
import { PrazoEmLoteDialogo } from "../../componentes/PrazoEmLoteDialogo";
import { SeloEstadoTarefa } from "../../componentes/selos";
import { Botao } from "../../ui/botao";
import { AreaTexto, Campo, EntradaData, Selecao } from "../../ui/campos";
import { useTerritorioAtivo } from "../../layout/territorio";
import { Dialogo } from "../../ui/dialogo";
import { Carregando, Erro, ListaVazia } from "../../ui/estados";
import { contarFiltros } from "../../util/filtros";
import { CabecalhoPagina, Paginacao } from "../../ui/pagina";
import { MenuAcoes, type ItemMenu } from "../../ui/menu";
import { Selo } from "../../ui/selo";
import { Linha, Tabela, Td, Th } from "../../ui/tabela";
import { invalidarCaminhos } from "../../util/cache";
import { contar, formatarData } from "../../util/formatos";
import { excedeLimiteDoLote, useSelecaoEmLote } from "../../util/lote";
import { EquipeEmLoteDialogo } from "./EquipeEmLoteDialogo";
import { rotuloDaAcao } from "./rotulos";

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
  const filtros = useSearch({ from: "/autenticado/equipes-tarefas/" });
  const navegar = useNavigate({ from: "/equipes-tarefas/" });
  const podeEditar = usePermissao("tarefas.editar");
  const equipes = useEquipesListar({ ativa: true, tamanho: 200 });
  const territorioAtivo = useTerritorioAtivo();
  const consulta = useTarefasListar({
    ...filtros,
    bairro: territorioAtivo.id,
    estado: filtros.estado ?? "abertas",
    atrasadas: filtros.atrasadas === "true" ? true : undefined,
    tamanho: TAMANHO,
  });
  const [transicao, setTransicao] = useState<{ tarefa: Tarefa; estado: EstadoTarefaEnum } | null>(
    null,
  );
  const [atribuindo, setAtribuindo] = useState<Tarefa | null>(null);
  const [acaoEmLote, setAcaoEmLote] = useState<"equipe" | "prazo" | null>(null);
  const filtrar = (parcial: Partial<BuscaTarefas>) =>
    void navegar({ search: (s: BuscaTarefas) => ({ ...s, ...parcial, pagina: undefined }) });
  // A seleção atravessa as páginas, mas só vale para os filtros em que foi feita.
  const selecao = useSelecaoEmLote(
    JSON.stringify({ ...filtros, pagina: undefined, bairro: territorioAtivo.id }),
    consulta.data?.data.results.map((t) => t.id) ?? [],
    consulta.data?.data.count ?? 0,
  );
  // Os mesmos filtros da lista, para "todas as filtradas" valer exatamente o que ela mostra.
  const filtrosDoLote = filtrosParaExportar({
    ...filtros,
    bairro: territorioAtivo.id,
    estado: filtros.estado ?? "abertas",
  });

  return (
    <div className="mx-auto max-w-7xl">
      <CabecalhoPagina
        titulo="Equipes e tarefas"
        descricao="Tarefas de campo por responsável, equipe e prazo. Crie tarefas de inspeção em lote a partir do inventário."
        acoes={
          <>
            <BotaoExportarCsv
              conjunto="tarefas"
              leitura="tarefas.ler"
              filtros={{
                ...filtros,
                bairro: territorioAtivo.id,
                estado: filtros.estado ?? "abertas",
              }}
            />
            {podeEditar && (
              <Botao variante="secundario" asChild>
                <Link to="/inventario/arvores">Criar tarefas a partir do inventário</Link>
              </Botao>
            )}
          </>
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
                  {contar(e.membros.length, "membro", "membros")} ·{" "}
                  {e.territorios.map((t) => t.nome).join(", ") || "sem território"}
                </p>
                {(e.membros.length === 0 || e.territorios.length === 0) && (
                  <Selo tom="atencao" className="mt-1">
                    Incompleta
                  </Selo>
                )}
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
        <ListaVazia
          filtrada={contarFiltros({ ...filtros, bairro: territorioAtivo.id }) > 0}
          aoLimparFiltros={() => void navegar({ search: {} })}
          titulo="Ainda não há tarefas"
          acao={
            podeEditar && (
              <Botao asChild>
                <Link to="/inventario/arvores">Criar tarefas a partir do inventário</Link>
              </Botao>
            )
          }
        >
          Tarefas de inspeção são criadas a partir de árvores do inventário: selecione as árvores,
          escolha a equipe e o prazo.
        </ListaVazia>
      ) : (
        <>
          {podeEditar && (
            <BarraAcoesEmLote
              total={selecao.total}
              singular="tarefa selecionada"
              plural="tarefas selecionadas"
              aoLimpar={selecao.limpar}
              todosFiltrados={selecao.todosFiltrados}
              totalFiltrado={consulta.data.data.count}
              aoSelecionarTodos={
                selecao.podeSelecionarTodos ? selecao.selecionarTodosFiltrados : undefined
              }
            >
              <Botao
                variante="secundario"
                disabled={excedeLimiteDoLote(selecao.total, selecao.todosFiltrados)}
                onClick={() => setAcaoEmLote("equipe")}
              >
                Reatribuir equipe
              </Botao>
              <Botao
                variante="secundario"
                disabled={excedeLimiteDoLote(selecao.total, selecao.todosFiltrados)}
                onClick={() => setAcaoEmLote("prazo")}
              >
                Definir prazo
              </Botao>
            </BarraAcoesEmLote>
          )}
          <Tabela>
            <thead>
              <tr>
                {podeEditar && (
                  <Th className="w-10">
                    <CaixaDaPagina
                      rotulo="Selecionar todas as tarefas da página"
                      inteira={selecao.paginaInteira}
                      parcial={selecao.paginaParcial}
                      aoAlternar={selecao.alternarPagina}
                    />
                  </Th>
                )}
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
                  {podeEditar && (
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${t.codigo}`}
                        className="size-4 accent-marca"
                        checked={selecao.marcada(t.id)}
                        onChange={(e) => selecao.alternar(t.id, e.target.checked)}
                      />
                    </Td>
                  )}
                  <Td>
                    <Link
                      to="/equipes-tarefas/$id"
                      params={{ id: t.id }}
                      className="font-mono font-medium whitespace-nowrap text-marca-escura hover:underline"
                    >
                      {t.codigo}
                    </Link>
                    <p className="text-xs text-texto-suave">{ROTULOS_TIPO_TAREFA[t.tipo]}</p>
                    {t.descricao && <p className="text-xs">{t.descricao}</p>}
                  </Td>
                  <Td>
                    {t.alvo.tipo === "arvore" ? (
                      <Link
                        to="/inventario/arvores/$id"
                        params={{ id: String(t.alvo.id) }}
                        className="font-mono whitespace-nowrap text-marca-escura hover:underline"
                      >
                        {String(t.alvo.codigo)}
                      </Link>
                    ) : (
                      <Link
                        to="/ocorrencias/$id"
                        params={{ id: String(t.alvo.id) }}
                        className="font-mono whitespace-nowrap text-marca-escura hover:underline"
                      >
                        {String(t.alvo.codigo)}
                      </Link>
                    )}
                    {t.origem?.tipo === "inspecao" && (
                      <p className="text-xs text-texto-suave">
                        Origem:{" "}
                        <Link
                          to="/inspecoes/$id"
                          params={{ id: t.origem.id }}
                          className="font-mono text-marca-escura hover:underline"
                        >
                          {t.origem.codigo}
                        </Link>
                      </p>
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
                    <AcoesTarefa
                      tarefa={t}
                      podeEditar={podeEditar}
                      aoTransitar={(estado) => setTransicao({ tarefa: t, estado })}
                      aoReatribuir={() => setAtribuindo(t)}
                    />
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
      {acaoEmLote === "equipe" && (
        <EquipeEmLoteDialogo
          alvo={selecao.alvo(filtrosDoLote)}
          total={selecao.total}
          aoFechar={(alterou) => {
            setAcaoEmLote(null);
            if (alterou) selecao.limpar();
          }}
        />
      )}
      {acaoEmLote === "prazo" && (
        <PrazoEmLoteDialogo
          recurso="tarefas"
          alvo={selecao.alvo(filtrosDoLote)}
          total={selecao.total}
          aoFechar={(alterou) => {
            setAcaoEmLote(null);
            if (alterou) selecao.limpar();
          }}
        />
      )}
    </div>
  );
}

/** Uma ação principal por linha; bloquear, cancelar e reatribuir ficam no menu "⋯". */
function AcoesTarefa({
  tarefa: t,
  podeEditar,
  aoTransitar,
  aoReatribuir,
}: {
  tarefa: Tarefa;
  podeEditar: boolean;
  aoTransitar: (estado: EstadoTarefaEnum) => void;
  aoReatribuir: () => void;
}) {
  // Bloqueada não pode ser "iniciada": a ação principal é desbloquear, com motivo.
  const bloqueada = t.estado === "bloqueada";
  const principal = bloqueada
    ? t.transicoes_possiveis.find((e) => e === "nao_iniciada")
    : t.transicoes_possiveis.find((e) => e !== "cancelada" && e !== "bloqueada");
  const itens: ItemMenu[] = [
    ...t.transicoes_possiveis
      .filter((e) => e !== principal && !(bloqueada && e === "em_execucao"))
      .map((e) => ({
        rotulo: rotuloDaAcao(t, e),
        aoEscolher: () => aoTransitar(e),
        perigo: e === "cancelada",
      })),
    ...(podeEditar && t.transicoes_possiveis.length > 0
      ? [{ rotulo: "Reatribuir", aoEscolher: aoReatribuir }]
      : []),
  ];
  return (
    <div className="flex items-center justify-end gap-1">
      {principal && (
        <Botao tamanho="pequeno" onClick={() => aoTransitar(principal)}>
          {rotuloDaAcao(t, principal)}
        </Botao>
      )}
      <MenuAcoes rotulo={`Mais ações de ${t.codigo}`} itens={itens} />
    </div>
  );
}

export function TransicaoDialogo({
  tarefa,
  estado,
  aoFechar,
  fotos,
  naPaginaDaTarefa = false,
}: {
  tarefa: Tarefa;
  estado: EstadoTarefaEnum;
  aoFechar: () => void;
  /** Fotos já anexadas, quando quem chama as conhece (a página da tarefa); senão, o total da lista. */
  fotos?: number;
  naPaginaDaTarefa?: boolean;
}) {
  const [motivo, setMotivo] = useState("");
  const [resultado, setResultado] = useState("");
  const mutacao = useTarefasTransicao<ErroApi>();
  const cliente = useQueryClient();
  const desbloqueio = tarefa.estado === "bloqueada";
  const concluindo = estado === "concluida";
  const exige = estado === "bloqueada" || estado === "cancelada" || desbloqueio;
  // A regra vale no servidor; aqui só se evita o envio que seria recusado.
  const faltaFoto =
    concluindo && tarefa.exige_evidencia && (fotos ?? tarefa.total_evidencias) === 0;
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={`${rotuloDaAcao(tarefa, estado)} ${tarefa.codigo}`}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao
            disabled={
              (exige && !motivo.trim()) ||
              (concluindo && !resultado.trim()) ||
              faltaFoto ||
              mutacao.isPending
            }
            onClick={() =>
              mutacao.mutate(
                {
                  id: tarefa.id,
                  data: {
                    estado,
                    motivo: motivo.trim(),
                    ...(concluindo ? { resultado: resultado.trim() } : {}),
                  },
                },
                {
                  onSuccess: async () => (
                    await invalidarCaminhos(cliente, "/api/v1/tarefas", "/api/v1/ocorrencias"),
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
        <p role="alert" className="mb-3 text-sm text-perigo">
          {Object.values(mutacao.error.errosDeCampo).flat()[0] ?? mutacao.error.message}
        </p>
      )}
      {desbloqueio && tarefa.motivo_estado && (
        <p className="mb-3 rounded-md bg-atencao-clara px-3 py-2 text-sm text-atencao">
          Bloqueada por: {tarefa.motivo_estado}
        </p>
      )}
      {faltaFoto && (
        <p role="alert" className="mb-3 rounded-md bg-atencao-clara px-3 py-2 text-sm text-atencao">
          Esta é uma tarefa de execução em campo: anexe ao menos uma foto do serviço antes de
          concluir.{" "}
          {naPaginaDaTarefa ? (
            "Use a seção Evidências desta página."
          ) : (
            <Link
              to="/equipes-tarefas/$id"
              params={{ id: tarefa.id }}
              className="font-medium underline"
            >
              Abrir a tarefa para anexar a foto
            </Link>
          )}
        </p>
      )}
      <div className="flex flex-col gap-3">
        {concluindo && (
          <Campo
            rotulo="Resultado"
            obrigatorio
            ajuda="O que foi feito. Fica no histórico da tarefa."
          >
            {(p) => (
              <AreaTexto {...p} value={resultado} onChange={(e) => setResultado(e.target.value)} />
            )}
          </Campo>
        )}
        <Campo
          rotulo={
            desbloqueio ? "Por que o bloqueio acabou" : exige ? "Motivo" : "Observação (opcional)"
          }
          obrigatorio={exige}
        >
          {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Campo>
      </div>
    </Dialogo>
  );
}

export function ReatribuirDialogo({ tarefa, aoFechar }: { tarefa: Tarefa; aoFechar: () => void }) {
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
        <AvisoEquipeIncompleta equipe={equipes.data?.data.results.find((e) => e.id === equipe)} />
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
          {(p) => <EntradaData {...p} value={prazo} onChange={(v) => setPrazo(v)} />}
        </Campo>
        <Campo rotulo="Motivo" obrigatorio>
          {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </Campo>
      </div>
    </Dialogo>
  );
}
