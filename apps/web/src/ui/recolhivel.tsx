import { ChevronRight } from "lucide-react";
import type { DetailsHTMLAttributes, ReactNode } from "react";

import { cn } from "../util/cn";

/**
 * Seção recolhível no padrão da interface (R3-08): chevron do ícone em vez do
 * triângulo do navegador, área de clique de 36 px e espaçamento fixo. Usa o
 * `<details>` nativo, então o teclado e os leitores de tela funcionam sem código.
 */
export function Recolhivel({
  titulo,
  children,
  className,
  classeCorpo,
  ...props
}: Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "title"> & {
  titulo: ReactNode;
  classeCorpo?: string;
}) {
  return (
    <details className={cn("group mt-2", className)} {...props}>
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-md py-1.5 text-sm font-medium select-none marker:hidden hover:text-texto [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden
        />
        {titulo}
      </summary>
      <div className={cn("pb-1 pl-5.5", classeCorpo)}>{children}</div>
    </details>
  );
}
