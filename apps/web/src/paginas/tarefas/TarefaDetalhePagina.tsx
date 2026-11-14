import {
  getTarefasHistoricoQueryKey,
  getTarefasObterQueryKey,
  useEvidenciasListar,
  useTarefasHistorico,
  useTarefasObter,
  type EstadoTarefaEnum,
  type Tarefa,
} from "@itree/api-client";
import { ROTULOS_TIPO_TAREFA } from "@itree/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState, type ReactNode } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { Evidencias } from "../../componentes/Evidencias";
import { LinhaDoTempo } from "../../componentes/Historico";
import { SeloEstadoTarefa } from "../../componentes/selos";
import { classeCodigo } from "../../ui/codigo";
import { Botao } from "../../ui/botao";
import { Carregando, Erro } from "../../ui/estados";
import { CabecalhoPagina } from "../../ui/pagina";
import { Selo } from "../../ui/selo";
import { descreverPrazo, formatarData, formatarDataHora } from "../../util/formatos";
import { rotuloDaAcao } from "./rotulos";
import { ReatribuirDialogo, TransicaoDialogo } from "./TarefasPagina";

const classeLink = `${classeCodigo} hover:underline`;

/** Detalhe da tarefa (M-20): origem, responsável, prazo, ações, resultado, evidências e histórico. */
export function TarefaDetalhePagina() {
  const { id } = useParams({ from: "/autenticado/equipes-tarefas/$id" });
  const consulta = useTarefasObter(id);
  return (
    <div className="mx-auto max-w-5xl">
      {/* Com os dados carregados, as migalhas do cabeçalho já levam de volta; o link só fica no erro. */}
      {consulta.isError && (
        <Link
          to="/equipes-tarefas"
          className="mb-3 inline-flex items-center gap-1 text-sm text-texto-suave hover:text-texto"
        >
          <ArrowLeft className="size-4" aria-hidden /> Equipes e tarefas
        </Link>
      )}
      {consulta.isPending ? (
        <Carregando linhas={8} />
      ) : consulta.isError ? (
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      ) : (
        <Detalhe tarefa={consulta.data.data} />
      )}
    </div>
  );
}

function Cartao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-borda bg-superficie p-4">
      <h2 className="mb-2 font-semibold">{titulo}</h2>
      <div className="text-sm">{children}</div>
    </section>
  );
}

function Detalhe({ tarefa: t }: { tarefa: Tarefa }) {
  const podeEditar = usePermissao("tarefas.editar");
  const encerrada = t.estado === "concluida" || t.estado === "cancelada";
  const [transicao, setTransicao] = useState<EstadoTarefaEnum | null>(null);
  const [reatribuindo, setReatribuindo] = useState(false);
  const historico = useTarefasHistorico(t.id);
  const evidencias = useEvidenciasListar({ tarefa: t.id });
  const fotos = evidencias.data?.data.filter((e) => e.eh_imagem).length;
  const cliente = useQueryClient();

  // Bloqueada não "inicia": a ação principal é desbloquear, com motivo. O mais provável ganha destaque.
  const bloqueada = t.estado === "bloqueada";
  const principal = bloqueada
    ? t.transicoes_possiveis.find((e) => e === "nao_iniciada")
    : t.transicoes_possiveis.find((e) => e !== "cancelada" && e !== "bloqueada");
  const secundarias = t.transicoes_possiveis.filter(
    (e) => e !== principal && e !== "cancelada" && !(bloqueada && e === "em_execucao"),
  );
  const alvoEhArvore = t.alvo.tipo === "arvore";

  return (
    <>
      <CabecalhoPagina
        titulo={`${t.codigo} · ${ROTULOS_TIPO_TAREFA[t.tipo]}`}
        migalhas={[{ rotulo: "Equipes e tarefas", para: "/equipes-tarefas" }, { rotulo: t.codigo }]}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <SeloEstadoTarefa estado={t.estado} />
            {t.atrasada && <Selo tom="perigo">Atrasada</Selo>}
            <span>
              Criada em {formatarDataHora(t.criado_em)} por{" "}
              {t.criada_por.nome || t.criada_por.email}
            </span>
          </span>
        }
      />

      {t.transicoes_possiveis.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-borda bg-superficie px-4 py-3">
          <span className="text-sm text-texto-suave">Próximo passo:</span>
          {[principal, ...secundarias]
            .filter((e): e is EstadoTarefaEnum => Boolean(e))
            .map((e) => (
              <Botao
                key={e}
                tamanho="pequeno"
                variante={e === principal ? "primario" : "secundario"}
                onClick={() => setTransicao(e)}
              >
                {rotuloDaAcao(t, e)}
              </Botao>
            ))}
          {podeEditar && (
            <Botao tamanho="pequeno" variante="secundario" onClick={() => setReatribuindo(true)}>
              Reatribuir
            </Botao>
          )}
          {/* Cancelar é destrutivo: contorno, afastado da ação principal e com motivo. */}
          {t.transicoes_possiveis.includes("cancelada") && (
            <Botao
              tamanho="pequeno"
              variante="perigoContorno"
              className="ml-auto"
              onClick={() => setTransicao("cancelada")}
            >
              {rotuloDaAcao(t, "cancelada")}
            </Botao>
          )}
        </div>
      )}

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Cartao titulo="Origem e alvo">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5">
            <dt className="text-texto-suave">{alvoEhArvore ? "Árvore" : "Ocorrência"}</dt>
            <dd>
              {alvoEhArvore ? (
                <Link
                  to="/inventario/arvores/$id"
                  params={{ id: String(t.alvo.id) }}
                  className={classeLink}
                >
                  {String(t.alvo.codigo)}
                </Link>
              ) : (
                <Link
                  to="/ocorrencias/$id"
                  params={{ id: String(t.alvo.id) }}
                  className={classeLink}
                >
                  {String(t.alvo.codigo)}
                </Link>
              )}
            </dd>
            {t.origem?.tipo === "inspecao" && (
              <>
                <dt className="text-texto-suave">Origem</dt>
                <dd>
                  <Link to="/inspecoes/$id" params={{ id: t.origem.id }} className={classeLink}>
                    {t.origem.codigo}
                  </Link>
                  <span className="text-texto-suave"> · a inspeção que gerou a ocorrência</span>
                </dd>
              </>
            )}
            {t.descricao && (
              <>
                <dt className="text-texto-suave">Descrição</dt>
                <dd className="break-words">{t.descricao}</dd>
              </>
            )}
          </dl>
        </Cartao>

        <Cartao titulo="Responsável e prazo">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5">
            <dt className="text-texto-suave">Responsável</dt>
            <dd>
              {t.responsavel ? (
                t.responsavel.nome || t.responsavel.email
              ) : (
                <span className="text-texto-suave">Sem responsável</span>
              )}
            </dd>
            <dt className="text-texto-suave">Equipe</dt>
            <dd>{t.equipe?.nome ?? <span className="text-texto-suave">Sem equipe</span>}</dd>
            <dt className="text-texto-suave">Prazo</dt>
            <dd>
              {t.prazo ? (
                <>
                  {formatarData(t.prazo)}
                  {!encerrada && (
                    <span className={t.atrasada ? "text-perigo" : "text-texto-suave"}>
                      {" · "}
                      {descreverPrazo(t.prazo)}
                    </span>
                  )}
                </>
              ) : (
                "Sem prazo"
              )}
            </dd>
            {t.concluida_em && (
              <>
                <dt className="text-texto-suave">Concluída em</dt>
                <dd>{formatarDataHora(t.concluida_em)}</dd>
              </>
            )}
          </dl>
        </Cartao>
      </div>

      {(t.resultado || t.motivo_estado) && (
        <div className="mb-4 flex flex-col gap-4">
          {t.resultado && (
            <Cartao titulo="Resultado">
              <p className="break-words whitespace-pre-line">{t.resultado}</p>
            </Cartao>
          )}
          {t.motivo_estado && (
            <Cartao
              titulo={
                t.estado === "bloqueada"
                  ? "Motivo do bloqueio"
                  : t.estado === "cancelada"
                    ? "Motivo do cancelamento"
                    : "Observação"
              }
            >
              <p className="break-words whitespace-pre-line">{t.motivo_estado}</p>
            </Cartao>
          )}
        </div>
      )}

      <h2 className="mb-1 font-semibold">Evidências</h2>
      {t.exige_evidencia && !encerrada && (
        <p className="mb-2 text-sm text-texto-suave">
          Tarefa de execução em campo: para concluir, anexe ao menos uma foto do serviço
          {fotos === 0 ? " (ainda não há nenhuma)." : "."}
        </p>
      )}
      <div className="mb-6">
        <Evidencias alvo={{ tarefa: t.id }} podeEnviar={!encerrada} />
      </div>

      <section className="mb-6 rounded-lg border border-borda bg-superficie p-4">
        <h2 className="mb-3 font-semibold">Histórico</h2>
        <LinhaDoTempo
          eventos={historico.data?.data}
          carregando={historico.isPending}
          erro={historico.error}
        />
      </section>

      {transicao && (
        <TransicaoDialogo
          tarefa={t}
          estado={transicao}
          fotos={fotos}
          naPaginaDaTarefa
          aoFechar={() => {
            setTransicao(null);
            void cliente.invalidateQueries({ queryKey: getTarefasObterQueryKey(t.id) });
            void cliente.invalidateQueries({ queryKey: getTarefasHistoricoQueryKey(t.id) });
          }}
        />
      )}
      {reatribuindo && (
        <ReatribuirDialogo
          tarefa={t}
          aoFechar={() => {
            setReatribuindo(false);
            void cliente.invalidateQueries({ queryKey: getTarefasHistoricoQueryKey(t.id) });
          }}
        />
      )}
    </>
  );
}
