import {
  useOperacoesEmLoteObter,
  type IgnoradoEmLote,
  type OperacaoEmLote,
  type ResultadoAcaoEmLote,
} from "@itree/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";

import { Botao } from "../ui/botao";
import { Dialogo } from "../ui/dialogo";
import { invalidarCaminhos } from "../util/cache";
import { plural } from "../util/formatos";
import { LIMITE_ACOES_EM_LOTE, LIMITE_OPERACAO_EM_LOTE, excedeLimiteDoLote } from "../util/lote";

/** Faixa com a contagem da seleção e as ações em lote, que o chamador filtra por permissão. */
export function BarraAcoesEmLote({
  total,
  singular,
  plural: pluralForma,
  aoLimpar,
  todosFiltrados = false,
  totalFiltrado,
  aoSelecionarTodos,
  children,
}: {
  total: number;
  /** "ocorrência selecionada" */
  singular: string;
  /** "ocorrências selecionadas" */
  plural: string;
  aoLimpar: () => void;
  /** A seleção é "todos os filtrados", e não só as linhas marcadas. */
  todosFiltrados?: boolean;
  /** Total que os filtros alcançam, para oferecer "Selecionar todos os N filtrados". */
  totalFiltrado?: number;
  /** Presente só quando vale oferecer a seleção de todos os filtrados. */
  aoSelecionarTodos?: () => void;
  children: ReactNode;
}) {
  if (total === 0) return null;
  const excede = excedeLimiteDoLote(total, todosFiltrados);
  const emSegundoPlano = todosFiltrados && !excede && total > LIMITE_ACOES_EM_LOTE;
  return (
    <div
      role="region"
      aria-label="Ações da seleção"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-marca bg-marca-clara px-3 py-2"
    >
      <p role="status" className="mr-2 text-sm font-medium">
        {plural(total, singular, pluralForma)}
        {todosFiltrados && (
          <span className="font-normal text-texto-suave"> (todos os filtrados)</span>
        )}
      </p>
      {aoSelecionarTodos && totalFiltrado !== undefined && (
        <Botao variante="fantasma" onClick={aoSelecionarTodos}>
          Selecionar todos os {totalFiltrado.toLocaleString("pt-BR")} filtrados
        </Botao>
      )}
      {children}
      <Botao variante="fantasma" onClick={aoLimpar}>
        Limpar seleção
      </Botao>
      {excede && (
        <p role="alert" className="basis-full text-xs text-perigo">
          {todosFiltrados
            ? `Os filtros alcançam ${total} registros; o limite é de ${LIMITE_OPERACAO_EM_LOTE} por ação. Refine os filtros para continuar.`
            : `O limite é de ${LIMITE_ACOES_EM_LOTE} registros por ação. Desmarque ${total - LIMITE_ACOES_EM_LOTE} para continuar.`}
        </p>
      )}
      {emSegundoPlano && (
        <p className="basis-full text-xs text-texto-suave">
          Acima de {LIMITE_ACOES_EM_LOTE} registros a ação roda em segundo plano, e você acompanha o
          andamento.
        </p>
      )}
    </div>
  );
}

/** A ação mudou (ou vai mudar) registros: a seleção pode ser limpa. */
export function alterouRegistros(resultado: ResultadoAcaoEmLote | OperacaoEmLote): boolean {
  return "estado" in resultado ? resultado.estado !== "falhou" : resultado.atualizadas > 0;
}

/** Resultado de uma ação em lote: quantos mudaram e, de cada um que não mudou, o motivo. */
export function ResultadoDoLote({
  resultado,
  aoFechar,
  titulo,
}: {
  resultado: ResultadoAcaoEmLote | OperacaoEmLote;
  aoFechar: () => void;
  titulo: string;
}) {
  if ("estado" in resultado) {
    return <AcompanhamentoDoLote inicial={resultado} aoFechar={aoFechar} titulo={titulo} />;
  }
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={titulo}
      rodape={<Botao onClick={aoFechar}>Fechar</Botao>}
    >
      <p role="status" className="text-sm">
        <strong>{resultado.atualizadas}</strong>{" "}
        {resultado.atualizadas === 1 ? "registro alterado" : "registros alterados"}.
      </p>
      <RegistrosNaoAlterados itens={resultado.ignoradas} total={resultado.ignoradas.length} />
    </Dialogo>
  );
}

function RegistrosNaoAlterados({
  itens,
  total,
}: {
  itens: readonly IgnoradoEmLote[];
  total: number;
}) {
  if (total === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-sm font-medium">
        {plural(total, "registro não foi alterado", "registros não foram alterados")}
      </p>
      <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5 text-sm text-texto-suave">
        {itens.map((i) => (
          <li key={i.id}>
            {i.codigo && <span className="font-mono">{i.codigo}: </span>}
            {i.motivo}
          </li>
        ))}
      </ul>
      {total > itens.length && (
        <p className="mt-1 text-xs text-texto-suave">
          E mais {total - itens.length}, sem o motivo guardado.
        </p>
      )}
    </div>
  );
}

/**
 * Acompanha uma ação em lote que roda em segundo plano (M-26): consulta o servidor até a
 * operação terminar, mostra o progresso e, no fim, o resultado. Pode ser fechada sem
 * interromper a operação.
 */
function AcompanhamentoDoLote({
  inicial,
  aoFechar,
  titulo,
}: {
  inicial: OperacaoEmLote;
  aoFechar: () => void;
  titulo: string;
}) {
  const cliente = useQueryClient();
  const consulta = useOperacoesEmLoteObter(inicial.id, {
    query: {
      refetchInterval: (c) =>
        c.state.data &&
        c.state.data.data.estado !== "pendente" &&
        c.state.data.data.estado !== "em_andamento"
          ? false
          : 1500,
    },
  });
  const operacao = consulta.data?.data ?? inicial;
  const terminou = operacao.estado === "concluida" || operacao.estado === "falhou";
  useEffect(() => {
    if (terminou) void invalidarCaminhos(cliente, `/api/v1/${operacao.recurso}`);
  }, [terminou, cliente, operacao.recurso]);
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={titulo}
      rodape={<Botao onClick={aoFechar}>Fechar</Botao>}
    >
      {!terminou && (
        <div role="status" className="text-sm">
          <p>
            {operacao.estado === "pendente" ? "Na fila para começar." : "Em andamento."}{" "}
            {operacao.processados.toLocaleString("pt-BR")} de{" "}
            {operacao.total.toLocaleString("pt-BR")} processados.
          </p>
          <progress
            className="mt-2 h-2 w-full accent-marca"
            aria-label="Andamento da ação em lote"
            max={operacao.total}
            value={operacao.processados}
          />
          <p className="mt-2 text-xs text-texto-suave">
            Pode fechar esta janela: a ação continua em segundo plano.
          </p>
        </div>
      )}
      {operacao.estado === "falhou" && (
        <p role="alert" className="text-sm text-perigo">
          {operacao.erro}
        </p>
      )}
      {terminou && (
        <p role="status" className="text-sm">
          <strong>{operacao.atualizadas.toLocaleString("pt-BR")}</strong>{" "}
          {operacao.atualizadas === 1 ? "registro alterado" : "registros alterados"} de{" "}
          {operacao.total.toLocaleString("pt-BR")}.
        </p>
      )}
      {terminou && <RegistrosNaoAlterados itens={operacao.motivos} total={operacao.falhas} />}
    </Dialogo>
  );
}

/** Checkbox de cabeçalho: marca a página inteira (indeterminado quando só parte está marcada). */
export function CaixaDaPagina({
  rotulo,
  inteira,
  parcial,
  aoAlternar,
}: {
  rotulo: string;
  inteira: boolean;
  parcial: boolean;
  aoAlternar: (marcado: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      aria-label={rotulo}
      className="size-4 accent-marca"
      checked={inteira}
      ref={(el) => {
        if (el) el.indeterminate = parcial;
      }}
      onChange={(e) => aoAlternar(e.target.checked)}
    />
  );
}
