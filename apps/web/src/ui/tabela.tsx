import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "../util/cn";

export function Tabela({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-borda bg-superficie">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-borda bg-fundo px-3 py-2 text-left text-xs font-semibold tracking-wide text-texto-suave uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-borda px-3 py-2.5 align-top", className)} {...props} />;
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
}: {
  children: string;
  direcao?: "asc" | "desc";
  aoOrdenar: () => void;
  className?: string;
}) {
  const Icone = direcao === "asc" ? ArrowUp : direcao === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <Th
      className={className}
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
