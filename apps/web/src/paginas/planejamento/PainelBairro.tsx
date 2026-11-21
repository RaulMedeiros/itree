import type { BairroPlanejamento, CriterioPlanejamento } from "@itree/api-client";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";

import { Botao } from "../../ui/botao";
import { Selo } from "../../ui/selo";
import {
  IDS_CRITERIOS,
  fonteDoCriterio,
  formatarPontuacao,
  formatarValor,
  type CriterioId,
  type LinhaPontuada,
  type Pesos,
} from "./calculo";

/** Valores brutos de cada critério no bairro escolhido, com unidade, fonte e ano. */
export function PainelBairro({
  bairro,
  linha,
  posicao,
  criterios,
  pesos,
  aoFechar,
}: {
  bairro: BairroPlanejamento;
  linha: LinhaPontuada | undefined;
  posicao: number | null;
  criterios: CriterioPlanejamento[];
  pesos: Pesos;
  aoFechar: () => void;
}) {
  return (
    <section
      aria-label={`Critérios de ${bairro.nome}`}
      className="rounded-xl border border-borda bg-superficie p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{bairro.nome}</h2>
          <p className="text-sm text-texto-suave">
            {linha?.pontuacao !== null && linha?.pontuacao !== undefined
              ? `Pontuação ${formatarPontuacao(linha.pontuacao)} de 100${posicao ? `, ${posicao}º no ranking` : ""}`
              : "Sem pontuação: nenhum critério ativo tem dado neste bairro."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Botao variante="secundario" tamanho="pequeno" asChild>
            <Link to="/bairros/$id" params={{ id: bairro.id }}>
              Abrir a ficha do bairro
            </Link>
          </Botao>
          <Botao
            variante="fantasma"
            tamanho="icone"
            aria-label="Fechar o painel"
            onClick={aoFechar}
          >
            <X aria-hidden />
          </Botao>
        </div>
      </div>
      <dl className="mt-3 divide-y divide-borda text-sm">
        {IDS_CRITERIOS.map((id) => {
          const c = criterios.find((x) => x.id === id);
          if (!c) return null;
          const valor = bairro.valores[id] ?? null;
          const percentil = bairro.percentis[id] ?? null;
          return (
            <div key={id} className="grid gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[1fr_auto]">
              <dt className="font-medium">
                {c.nome}
                {pesos[id] > 0 && c.disponivel && (
                  <span className="ml-1.5 text-xs font-normal text-texto-suave">
                    peso {pesos[id]}
                  </span>
                )}
                {!c.disponivel && (
                  <Selo tom="neutro" className="ml-1.5">
                    indisponível
                  </Selo>
                )}
              </dt>
              <dd className="font-semibold tabular-nums sm:text-right">
                {c.disponivel ? (
                  valor === null ? (
                    <span className="font-normal text-atencao">Sem dado</span>
                  ) : (
                    formatarValor(id as CriterioId, valor)
                  )
                ) : (
                  <span className="font-normal text-texto-suave">–</span>
                )}
              </dd>
              <dd className="text-xs text-texto-suave sm:col-span-2">
                {c.disponivel ? (
                  <>
                    {fonteDoCriterio(c)}
                    {percentil !== null &&
                      ` · prioridade neste critério: ${Math.round(percentil * 100)}% (percentil)`}
                  </>
                ) : (
                  c.motivo_indisponivel
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
