import { Link, useRouterState, type LinkProps } from "@tanstack/react-router";
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

/** Uma aba de seção. `para` é o destino; a ativa é a que contém o caminho atual. */
export interface AbaSecao {
  para: string;
  rotulo: string;
}

/**
 * Abas de seção (Inventário, Administração, Ocorrências…). Ficam sempre acima
 * do título, na mesma posição em todas as telas (R3-03). Somem nas rotas de
 * detalhe (R3-04).
 */
export function AbasSecao({ rotulo, abas }: { rotulo: string; abas: AbaSecao[] }) {
  const caminho = useRouterState({ select: (e) => e.location.pathname });
  // Nas rotas de detalhe a migalha já leva de volta à lista; a fila de abas
  // some e o conteúdo sobe (R3-04).
  if (abas.some((a) => caminho.startsWith(`${a.para}/`))) return null;
  return (
    <nav aria-label={rotulo} className="mb-4 flex gap-1 border-b border-borda">
      {abas.map((a) => (
        <Link
          key={a.para}
          to={a.para as LinkProps["to"]}
          className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-texto-suave hover:text-texto"
          activeProps={{ className: "border-marca! font-medium text-texto!" }}
          activeOptions={{ exact: false }}
        >
          {a.rotulo}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Cabeçalho de página num padrão único (R3-03): abas de seção, migalha, título
 * e descrição à esquerda; ações à direita, com a principal por último.
 */
export function CabecalhoPagina({
  titulo,
  descricao,
  acoes,
  migalhas,
  abas,
}: {
  titulo: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
  migalhas?: Migalha[];
  /** Normalmente `<AbasSecao />`; só quando a página não está num layout que já as mostre. */
  abas?: ReactNode;
}) {
  useTituloDocumento(titulo);
  return (
    <div className="mb-4">
      {abas}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          {migalhas && migalhas.length > 0 && <Migalhas itens={migalhas} />}
          <h1 className="text-xl font-semibold">{titulo}</h1>
          {descricao && <p className="mt-0.5 text-sm text-texto-suave">{descricao}</p>}
        </div>
        {acoes && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{acoes}</div>
        )}
      </div>
    </div>
  );
}

export function Paginacao({
  pagina,
  total,
  tamanho,
  aoMudar,
  unidade,
  nota,
}: {
  pagina: number;
  total: number;
  tamanho: number;
  aoMudar: (pagina: number) => void;
  /** O que se conta ("eventos"): evita "1–50 de 2.022" sem dizer do quê. */
  unidade?: string;
  /** Esclarecimento quando as linhas visíveis não são os itens contados (ex.: grupos). */
  nota?: string;
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
        {inicio}–{fim} de {total.toLocaleString("pt-BR")}
        {unidade ? ` ${unidade}` : ""}
        {nota ? ` (${nota})` : ""}
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
