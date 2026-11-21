import type { FichaCartao } from "@itree/api-client";

import { descricaoDaRegua, formatarValorCartao, posicaoNaEscala, posicaoNaReguaPct } from "./ficha";

/**
 * Régua discreta "bairro × referência de Fortaleza": o ponto é o bairro, o traço é a referência.
 * Sem ranking: só a posição dos dois valores. Percentual vai de 0 a 100%; os outros indicadores
 * vão do menor ao maior valor entre os bairros (`escala`).
 */
export function Regua({ cartao, nome }: { cartao: FichaCartao; nome: string }) {
  if (cartao.valor === null || !cartao.cidade) return null;
  const referencia = cartao.cidade;
  // Percentual: de 0 a 100. Os demais: do menor ao maior valor entre os bairros.
  const posicao = (v: number) =>
    cartao.unidade === "%" ? posicaoNaReguaPct(v) : posicaoNaEscala(v, cartao.escala);
  return (
    <div className="mt-3" data-testid={`regua-${cartao.id}`}>
      <div
        role="img"
        aria-label={descricaoDaRegua(cartao, nome)}
        className="relative h-1.5 rounded-full bg-neutro-clara"
      >
        <span
          aria-hidden
          className="absolute -top-1 h-3.5 w-0.5 rounded bg-texto"
          style={{ left: `${posicao(referencia.valor)}%` }}
        />
        <span
          aria-hidden
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-superficie bg-marca ring-1 ring-marca"
          style={{ left: `${posicao(cartao.valor)}%` }}
        />
      </div>
      <p className="mt-1.5 flex justify-between gap-2 text-xs text-texto-suave">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block size-2 rounded-full bg-marca" />
          Este bairro
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-2.5 w-0.5 rounded bg-texto" />
          {referencia.rotulo}:{" "}
          {formatarValorCartao({ valor: referencia.valor, unidade: cartao.unidade })}
        </span>
      </p>
    </div>
  );
}
