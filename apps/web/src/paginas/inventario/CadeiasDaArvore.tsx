import { useInspecoesListar, useOcorrenciasListar, type Ocorrencia } from "@itree/api-client";
import { ROTULOS_CONDICAO } from "@itree/domain";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import {
  SeloEstadoInspecao,
  SeloEstadoOcorrencia,
  SeloEstadoTarefa,
  SeloPrioridade,
} from "../../componentes/selos";
import { Carregando, Erro, Vazio } from "../../ui/estados";
import { Selo } from "../../ui/selo";
import { contar, descreverPrazo, formatarDataHora } from "../../util/formatos";
import { montarCadeias, type Cadeia } from "./cadeias";

const LIMITE = 100;
const classeLink = "font-mono font-medium text-marca-escura hover:underline";

/**
 * Cadeias da árvore (M-21): cada inspeção com a ocorrência que gerou e as tarefas dessa ocorrência,
 * em linha do tempo, com links e estados. Cada parte só aparece para quem pode ver o registro.
 */
export function CadeiasDaArvore({ arvoreId }: { arvoreId: string }) {
  const podeInspecoes = usePermissao("inspecoes.ler");
  const podeOcorrencias = usePermissao("ocorrencias.ler");
  const inspecoes = useInspecoesListar(
    { arvore: arvoreId, estado: "rascunho,em_revisao,devolvida,validada", tamanho: LIMITE },
    { query: { enabled: podeInspecoes } },
  );
  const ocorrencias = useOcorrenciasListar(
    { arvore: arvoreId, tamanho: LIMITE },
    { query: { enabled: podeOcorrencias } },
  );
  if (!podeInspecoes && !podeOcorrencias) {
    return <Vazio titulo="Você não tem acesso às inspeções nem às ocorrências" />;
  }
  if ((podeInspecoes && inspecoes.isPending) || (podeOcorrencias && ocorrencias.isPending)) {
    return <Carregando linhas={3} />;
  }
  const falha = (podeInspecoes && inspecoes.error) || (podeOcorrencias && ocorrencias.error);
  if (falha) return <Erro erro={falha} />;

  const dadosInspecoes = podeInspecoes ? (inspecoes.data?.data.results ?? []) : [];
  const dadosOcorrencias = podeOcorrencias ? (ocorrencias.data?.data.results ?? []) : [];
  const cadeias = montarCadeias(dadosInspecoes, dadosOcorrencias);
  if (cadeias.length === 0) {
    return (
      <Vazio titulo="Nenhuma cadeia para esta árvore">
        Aparece aqui quando a árvore tem inspeção ou ocorrência.
      </Vazio>
    );
  }
  const totais = [
    podeInspecoes && (inspecoes.data?.data.count ?? 0) > dadosInspecoes.length
      ? `${dadosInspecoes.length} das ${inspecoes.data?.data.count} inspeções`
      : null,
    podeOcorrencias && (ocorrencias.data?.data.count ?? 0) > dadosOcorrencias.length
      ? `${dadosOcorrencias.length} das ${ocorrencias.data?.data.count} ocorrências`
      : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-texto-suave">
        {contar(cadeias.length, "cadeia", "cadeias")}, da mais recente para a mais antiga: cada
        inspeção, a ocorrência que ela gerou e as tarefas de atendimento.
        {totais.length > 0 && ` Mostrando ${totais.join(" e ")} mais recentes.`}
        {!podeInspecoes && " Sem acesso às inspeções: as cadeias começam nas ocorrências."}
        {!podeOcorrencias && " Sem acesso às ocorrências: os desdobramentos não aparecem."}
      </p>
      <ol className="flex flex-col gap-4">
        {cadeias.map((c) => (
          <li key={c.chave}>
            <CartaoCadeia cadeia={c} mostrarTarefas={podeOcorrencias} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Passo({ children, nivel }: { children: ReactNode; nivel: 0 | 1 | 2 }) {
  const recuo = ["", "ml-5", "ml-10"][nivel];
  return (
    <li className={`relative border-l-2 border-borda pb-3 pl-4 last:pb-0 ${recuo}`}>
      <span className="absolute top-1.5 -left-[7px] size-3 rounded-full border-2 border-superficie bg-marca" />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">{children}</div>
    </li>
  );
}

function CartaoCadeia({ cadeia, mostrarTarefas }: { cadeia: Cadeia; mostrarTarefas: boolean }) {
  const { inspecao: i, ocorrencias } = cadeia;
  return (
    <section
      aria-label={i ? `Cadeia da inspeção ${i.codigo}` : "Cadeia sem inspeção de origem"}
      className="rounded-lg border border-borda bg-superficie p-4"
    >
      <ol className="flex flex-col">
        {i ? (
          <Passo nivel={0}>
            <span className="text-xs text-texto-suave">Inspeção</span>
            <Link to="/inspecoes/$id" params={{ id: i.id }} className={classeLink}>
              {i.codigo}
            </Link>
            {i.estado && <SeloEstadoInspecao estado={i.estado} />}
            {i.realizada_em && (
              <span className="text-sm text-texto-suave">
                {formatarDataHora(i.realizada_em)}
                {i.tecnico ? ` · ${i.tecnico.nome || i.tecnico.email}` : ""}
                {i.condicao_aparente ? ` · ${ROTULOS_CONDICAO[i.condicao_aparente]}` : ""}
              </span>
            )}
            {ocorrencias.length === 0 && (
              <span className="basis-full text-sm text-texto-suave">
                {i.requer_encaminhamento
                  ? "Requer encaminhamento, mas ainda não gerou ocorrência."
                  : "Sem ocorrência gerada."}
              </span>
            )}
          </Passo>
        ) : (
          <li className="mb-2 text-sm text-texto-suave">
            Sem inspeção de origem: ocorrência registrada diretamente.
          </li>
        )}
        {ocorrencias.map((o) => (
          <OcorrenciaDaCadeia
            key={o.id}
            ocorrencia={o}
            nivel={i ? 1 : 0}
            mostrarTarefas={mostrarTarefas}
          />
        ))}
      </ol>
    </section>
  );
}

function OcorrenciaDaCadeia({
  ocorrencia: o,
  nivel,
  mostrarTarefas,
}: {
  ocorrencia: Ocorrencia;
  nivel: 0 | 1;
  mostrarTarefas: boolean;
}) {
  return (
    <>
      <Passo nivel={nivel}>
        <span className="text-xs text-texto-suave">Ocorrência</span>
        <Link to="/ocorrencias/$id" params={{ id: o.id }} className={classeLink}>
          {o.codigo}
        </Link>
        <span className="text-sm">{o.tipo.nome}</span>
        <SeloEstadoOcorrencia estado={o.estado} />
        <SeloPrioridade prioridade={o.prioridade} />
        {o.atrasada && <Selo tom="perigo">Atrasada</Selo>}
        <span className="text-sm text-texto-suave">{formatarDataHora(o.criado_em)}</span>
      </Passo>
      {mostrarTarefas &&
        o.tarefas.map((t) => (
          <Passo key={t.id} nivel={(nivel + 1) as 1 | 2}>
            <span className="text-xs text-texto-suave">Tarefa</span>
            <Link to="/equipes-tarefas/$id" params={{ id: t.id }} className={classeLink}>
              {t.codigo}
            </Link>
            <SeloEstadoTarefa estado={t.estado} />
            <span className="text-sm text-texto-suave">
              {t.responsavel ?? "Sem responsável"}
              {t.prazo && t.estado !== "concluida" && t.estado !== "cancelada"
                ? ` · ${descreverPrazo(t.prazo)}`
                : ""}
            </span>
          </Passo>
        ))}
    </>
  );
}
