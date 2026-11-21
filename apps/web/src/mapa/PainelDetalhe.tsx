import { useState, type ComponentPropsWithoutRef } from "react";

import { cn } from "../util/cn";

/**
 * Painel de detalhe sobre o mapa. No desktop, um cartão no canto superior direito. No celular
 * (abaixo de `md`), uma folha inferior com alça: abre com metade da altura, deixando o mapa
 * visível acima, e a alça a expande ou recolhe.
 */
export function PainelDetalhe({
  rotulo,
  className,
  children,
  ...props
}: Omit<ComponentPropsWithoutRef<"aside">, "aria-label"> & { rotulo: string }) {
  const [expandido, setExpandido] = useState(false);
  return (
    <aside
      aria-label={rotulo}
      data-expandido={expandido}
      className={cn(
        "absolute top-3 right-3 z-10 flex max-h-[calc(100%-1.5rem)] w-96 flex-col overflow-y-auto rounded-xl border border-borda bg-superficie p-4 shadow-lg",
        "max-md:inset-x-0 max-md:top-auto max-md:right-0 max-md:bottom-0 max-md:w-full max-md:rounded-t-2xl max-md:rounded-b-none max-md:pt-2",
        expandido ? "max-md:max-h-[92%]" : "max-md:max-h-[48%]",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        aria-label={expandido ? "Recolher detalhes" : "Expandir detalhes"}
        aria-expanded={expandido}
        onClick={() => setExpandido((e) => !e)}
        className="-mx-4 mb-1 flex h-7 shrink-0 items-center justify-center md:hidden"
      >
        <span aria-hidden className="h-1.5 w-10 rounded-full bg-borda" />
      </button>
      {children}
    </aside>
  );
}
