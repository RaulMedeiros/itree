import type { FichaCartao } from "@itree/api-client";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Info } from "lucide-react";
import type { ReactNode } from "react";

import { Selo } from "../../ui/selo";
import { Recolhivel } from "../../ui/recolhivel";
import { cn } from "../../util/cn";
import { formatarValorCartao, textoDaFonte } from "./ficha";
import { Regua } from "./Regua";

/**
 * Cartão de indicador da ficha: valor, detalhe, régua contra a cidade (percentuais), fonte e data.
 * Sem dado, o cartão continua na grade e diz por quê: nunca vira zero nem some.
 */
export function CartaoIndicador({
  cartao,
  nome,
  destino,
}: {
  cartao: FichaCartao;
  nome: string;
  /** Link já resolvido (o mapa leva o enquadramento do bairro). */
  destino?: ReactNode;
}) {
  const percentual = cartao.unidade === "%";
  return (
    <article
      aria-label={cartao.titulo}
      className={cn(
        "evitar-quebra flex flex-col rounded-xl border border-borda bg-superficie p-4",
        cartao.sem_dado && "border-dashed bg-fundo/60",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-texto-suave">{cartao.titulo}</h3>
        {cartao.provisorio && (
          <Selo tom="atencao" title="Critério em definição pela prefeitura">
            Provisório
          </Selo>
        )}
      </header>

      {cartao.sem_dado ? (
        <div className="mt-2 flex-1">
          <p className="flex items-center gap-1.5 text-lg font-semibold text-texto-suave">
            <Info className="size-4" aria-hidden /> Sem dado neste bairro
          </p>
          <p className="mt-1 text-sm text-texto-suave">{cartao.nota}</p>
        </div>
      ) : (
        <div className="mt-1 flex-1">
          <p className="text-3xl leading-tight font-semibold tabular-nums">
            {formatarValorCartao(cartao)}
          </p>
          {cartao.detalhe && <p className="mt-0.5 text-sm text-texto-suave">{cartao.detalhe}</p>}
          {(percentual || cartao.escala) && <Regua cartao={cartao} nome={nome} />}
          {!percentual && !cartao.escala && cartao.cidade && (
            <p className="mt-2 text-xs text-texto-suave">
              {cartao.cidade.rotulo}:{" "}
              <strong className="tabular-nums">
                {formatarValorCartao({ valor: cartao.cidade.valor, unidade: cartao.unidade })}
              </strong>
            </p>
          )}
          {cartao.nota && <p className="mt-2 text-xs text-texto-suave">{cartao.nota}</p>}
        </div>
      )}

      {destino && <div className="mt-2 text-sm print:hidden">{destino}</div>}

      <p className="mt-3 border-t border-borda pt-2 text-xs text-texto-suave">
        Fonte: {textoDaFonte(cartao)}
      </p>
      {(cartao.definicao || cartao.metodo || cartao.licenca) && (
        <Recolhivel
          titulo="Como é calculado"
          className="mt-0 text-xs text-texto-suave print:hidden"
          classeCorpo="flex flex-col gap-1"
        >
          {cartao.definicao && <p>{cartao.definicao}</p>}
          {cartao.metodo && (
            <p>
              <strong>Método:</strong> {cartao.metodo}
            </p>
          )}
          {cartao.licenca && (
            <p>
              <strong>Licença:</strong> {cartao.licenca}
            </p>
          )}
          {cartao.fonte_url && (
            <a
              href={cartao.fonte_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-marca-escura hover:underline"
            >
              Abrir a fonte <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </Recolhivel>
      )}
    </article>
  );
}

/** Link de texto para o destino de um cartão, no estilo dos links da interface. */
export function LinkDoCartao({
  to,
  search,
  children,
}: {
  to: string;
  search?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <Link to={to} search={search} className="text-marca-escura hover:underline">
      {children}
    </Link>
  );
}
