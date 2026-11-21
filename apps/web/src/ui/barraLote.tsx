import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

import { cn } from "../util/cn";

/**
 * Barra de ações em lote de uma lista com seleção. No desktop fica acima da tabela; no celular
 * (abaixo de `md`) fica fixa no rodapé da tela, ao alcance do polegar, e o conteúdo ganha
 * espaço embaixo (a variável `--altura-barra-lote`, usada em `estilos.css`) para o último
 * cartão não ficar atrás dela.
 */
export function BarraAcoesLote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const barra = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const raiz = document.documentElement.style;
    raiz.setProperty("--altura-barra-lote", `${barra.current?.offsetHeight ?? 0}px`);
  });
  useLayoutEffect(
    () => () => {
      document.documentElement.style.removeProperty("--altura-barra-lote");
    },
    [],
  );

  return (
    <div
      ref={barra}
      role="region"
      aria-label="Ações da seleção"
      data-barra-lote
      className={cn(
        "mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-marca bg-marca-clara px-3 py-2",
        "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:mb-0 max-md:max-h-[45dvh] max-md:overflow-y-auto max-md:rounded-none max-md:border-x-0 max-md:border-b-0 max-md:pb-[calc(0.5rem+env(safe-area-inset-bottom))] max-md:shadow-[0_-4px_12px_rgb(0_0_0/0.15)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
