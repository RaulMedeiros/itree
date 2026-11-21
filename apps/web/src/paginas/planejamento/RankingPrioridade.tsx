import type { CriterioPlanejamento } from "@itree/api-client";

import { cn } from "../../util/cn";
import {
  COR_CRITERIO,
  ROTULO_CURTO,
  TAMANHO_RANKING,
  formatarPontuacao,
  type CriterioId,
  type LinhaPontuada,
} from "./calculo";

/** Os primeiros do ranking, com a contribuição de cada critério na barra empilhada. */
export function RankingPrioridade({
  ordenadas,
  ativos,
  criterios,
  selecionado,
  aoSelecionar,
}: {
  ordenadas: LinhaPontuada[];
  ativos: CriterioId[];
  criterios: CriterioPlanejamento[];
  selecionado?: string;
  aoSelecionar: (id: string) => void;
}) {
  const primeiros = ordenadas.slice(0, TAMANHO_RANKING);
  const nomes = new Map(criterios.map((c) => [c.id, c.nome]));
  return (
    <section
      aria-label="Ranking dos bairros"
      className="rounded-xl border border-borda bg-superficie"
    >
      <div className="px-4 pt-3">
        <h2 className="font-semibold">Os {TAMANHO_RANKING} bairros com maior prioridade</h2>
        <p className="text-xs text-texto-suave">
          Pontuação de 0 a 100. A barra mostra quanto cada critério contribuiu.
        </p>
        <ul aria-label="Legenda da barra" className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {ativos.map((id) => (
            <li key={id} className="flex items-center gap-1.5 text-texto-suave">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-sm"
                style={{ background: COR_CRITERIO[id] }}
              />
              {ROTULO_CURTO[id]}
            </li>
          ))}
        </ul>
      </div>
      {primeiros.length === 0 ? (
        <p className="px-4 py-6 text-sm text-texto-suave">
          Nenhum critério ativo: aumente o peso de ao menos um critério.
        </p>
      ) : (
        <ol className="mt-2 divide-y divide-borda">
          {primeiros.map((l, i) => {
            const descricao = ativos
              .filter((id) => l.contribuicoes[id] !== undefined)
              .map(
                (id) => `${ROTULO_CURTO[id]}: ${formatarPontuacao(l.contribuicoes[id] as number)}`,
              )
              .join("; ");
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => aoSelecionar(l.id)}
                  aria-pressed={selecionado === l.id}
                  className={cn(
                    "block w-full px-4 py-2 text-left hover:bg-neutro-clara",
                    selecionado === l.id && "bg-marca-clara",
                  )}
                >
                  <span className="flex items-baseline gap-2 text-sm">
                    <span className="w-6 shrink-0 text-right text-texto-suave tabular-nums">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{l.nome}</span>
                    <span className="font-semibold tabular-nums">
                      {formatarPontuacao(l.pontuacao as number)}
                    </span>
                  </span>
                  <span
                    role="img"
                    aria-label={`Contribuição de cada critério para ${l.nome}. ${descricao}`}
                    className="mt-1 ml-8 flex h-2.5 overflow-hidden rounded-sm bg-neutro-clara"
                  >
                    {ativos.map((id) =>
                      l.contribuicoes[id] ? (
                        <span
                          key={id}
                          title={`${nomes.get(id) ?? id}: ${formatarPontuacao(l.contribuicoes[id] as number)}`}
                          className="h-full border-r border-superficie last:border-r-0"
                          style={{
                            width: `${(l.contribuicoes[id] as number) * 100}%`,
                            background: COR_CRITERIO[id],
                          }}
                        />
                      ) : null,
                    )}
                  </span>
                  {l.semDado.length > 0 && (
                    <span className="mt-1 ml-8 block text-xs text-atencao">
                      Sem dado: {l.semDado.map((id) => ROTULO_CURTO[id]).join(", ")} (ignorado na
                      média)
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
