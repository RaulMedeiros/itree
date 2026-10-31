import type { ReactNode } from "react";

export function CabecalhoPagina({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
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
