import { Link, type LinkProps } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";

import { useTituloDocumento } from "../util/titulo";

/** Um nível do caminho. Só o último fica sem `para`: é a página atual. */
export interface Migalha {
  rotulo: string;
  para?: LinkProps["to"];
}

/** "Inventário › Árvores › ARV-000058": onde a pessoa está e o caminho de volta. */
export function Migalhas({ itens }: { itens: Migalha[] }) {
  return (
    <nav aria-label="Migalhas" className="mb-1.5 text-sm text-texto-suave">
      <ol className="flex flex-wrap items-center gap-x-1.5">
        {itens.map((m, n) => {
          const ultima = n === itens.length - 1;
          return (
            <Fragment key={`${n}-${m.rotulo}`}>
              <li className="min-w-0">
                {m.para && !ultima ? (
                  <Link to={m.para} className="rounded hover:text-texto hover:underline">
                    {m.rotulo}
                  </Link>
                ) : (
                  <span aria-current={ultima ? "page" : undefined} className="truncate">
                    {m.rotulo}
                  </span>
                )}
              </li>
              {!ultima && (
                <li aria-hidden className="select-none">
                  ›
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

export function CabecalhoPagina({
  titulo,
  descricao,
  acoes,
  migalhas,
}: {
  titulo: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
  migalhas?: Migalha[];
}) {
  useTituloDocumento(titulo);
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {migalhas && migalhas.length > 0 && <Migalhas itens={migalhas} />}
        <h1 className="text-xl font-semibold">{titulo}</h1>
        {descricao && <p className="mt-0.5 text-sm text-texto-suave">{descricao}</p>}
      </div>
      {acoes && <div className="flex gap-2">{acoes}</div>}
    </div>
  );
}

export function Paginacao({
  pagina,
  total,
  tamanho,
  aoMudar,
}: {
  pagina: number;
  total: number;
  tamanho: number;
  aoMudar: (pagina: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / tamanho));
  if (total === 0) return null;
  const inicio = (pagina - 1) * tamanho + 1;
  const fim = Math.min(total, pagina * tamanho);
  return (
    <nav
      aria-label="Paginação"
      className="mt-3 flex items-center justify-between text-sm text-texto-suave"
    >
      <span>
        {inicio}–{fim} de {total}
      </span>
      <div className="flex gap-2">
        <button
          className="rounded-md border border-borda bg-superficie px-2.5 py-1 disabled:opacity-50"
          disabled={pagina <= 1}
          onClick={() => aoMudar(pagina - 1)}
        >
          Anterior
        </button>
        <button
          className="rounded-md border border-borda bg-superficie px-2.5 py-1 disabled:opacity-50"
          disabled={pagina >= paginas}
          onClick={() => aoMudar(pagina + 1)}
        >
          Próxima
        </button>
      </div>
    </nav>
  );
}
