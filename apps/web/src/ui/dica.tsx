import { Info } from "lucide-react";
import { useState } from "react";

import { cn } from "../util/cn";

/**
 * Ícone "(i)" que guarda uma explicação longa fora da linha (R3-32): o texto aparece ao pousar o
 * cursor, ao clicar ou ao tocar, e fica no nome acessível do botão. Serve para o que explica por
 * que uma ação está indisponível, sem pesar a linha com três linhas de letra miúda.
 */
export function Dica({ texto, className }: { texto: string; className?: string }) {
  const [aberta, setAberta] = useState(false);
  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={texto}
        aria-expanded={aberta}
        title={texto}
        onClick={() => setAberta((a) => !a)}
        className="inline-flex size-8 items-center justify-center rounded-md text-texto-suave hover:text-texto"
      >
        <Info className="size-4" aria-hidden />
      </button>
      {aberta && (
        <span
          role="note"
          className="absolute top-full right-0 z-10 mt-1 w-60 rounded-md border border-borda bg-superficie p-2 text-left text-xs font-normal whitespace-normal text-texto shadow-md"
        >
          {texto}
        </span>
      )}
    </span>
  );
}
