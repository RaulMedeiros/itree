import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "../util/cn";

/**
 * Tabela com rolagem horizontal quando não cabe. Uma sombra na borda direita
 * avisa que há colunas escondidas; sem ela, a tabela cortada parece defeito (R3-10).
 */
export function Tabela({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  const area = useRef<HTMLDivElement>(null);
  const [maisADireita, setMaisADireita] = useState(false);

  const medir = useCallback(() => {
    const el = area.current;
    if (!el) return;
    setMaisADireita(el.scrollWidth - el.scrollLeft - el.clientWidth > 4);
  }, []);

  useEffect(() => {
    medir();
    const el = area.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    if (el.firstElementChild) observador.observe(el.firstElementChild);
    return () => observador.disconnect();
  }, [medir]);

  return (
    <div className="relative rounded-lg border border-borda bg-superficie">
      <div ref={area} onScroll={medir} className="overflow-x-auto rounded-lg">
        <table className={cn("w-full border-collapse text-sm", className)} {...props} />
      </div>
      {maisADireita && (
        <div
          data-testid="mais-colunas"
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-6 rounded-r-lg bg-gradient-to-l from-texto/15 to-transparent"
        />
      )}
    </div>
  );
}

/**
 * Cabeçalho de coluna: o rótulo não quebra em várias linhas. Para um rótulo longo,
 * passe o curto como conteúdo e o completo em `dica` (aparece ao pousar o cursor).
 */
export function Th({
  className,
  dica,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { dica?: string }) {
  return (
    <th
      scope="col"
      title={dica}
      className={cn(
        "border-b border-borda bg-fundo px-3 py-2 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-texto-suave uppercase",
        className,
      )}
      {...props}
    />
  );
}

/** `semQuebra` mantém nomes de pessoa e de bairro numa linha só. */
export function Td({
  className,
  semQuebra,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { semQuebra?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-borda px-3 py-2.5 align-top",
        semQuebra && "whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

export function Linha({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("last:[&>td]:border-b-0", className)} {...props} />;
}

/** Cabeçalho clicável: `direcao` indica a ordenação atual desta coluna (undefined = não ordenada). */
export function ThOrdenavel({
  children,
  direcao,
  aoOrdenar,
  className,
  dica,
}: {
  children: string;
  dica?: string;
  direcao?: "asc" | "desc";
  aoOrdenar: () => void;
  className?: string;
}) {
  const Icone = direcao === "asc" ? ArrowUp : direcao === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <Th
      className={className}
      dica={dica}
      aria-sort={direcao === "asc" ? "ascending" : direcao === "desc" ? "descending" : "none"}
    >
      <button
        type="button"
        onClick={aoOrdenar}
        className="inline-flex items-center gap-1 font-semibold tracking-wide uppercase hover:text-texto"
      >
        {children}
        <Icone className={cn("size-3.5", !direcao && "opacity-50")} aria-hidden />
      </button>
    </Th>
  );
}
