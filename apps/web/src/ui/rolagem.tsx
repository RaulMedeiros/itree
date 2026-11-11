import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "../util/cn";

/**
 * Área com rolagem vertical que avisa quando há conteúdo escondido abaixo
 * (degradê e indicação), para controles cortados pela borda não passarem
 * por "fim do painel" (C-09).
 */
export function AreaRolavel({ className, children }: { className?: string; children: ReactNode }) {
  const area = useRef<HTMLDivElement>(null);
  const [maisAbaixo, setMaisAbaixo] = useState(false);

  const medir = useCallback(() => {
    const el = area.current;
    if (!el) return;
    setMaisAbaixo(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);

  useEffect(() => {
    medir();
    const el = area.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    for (const filho of Array.from(el.children)) observador.observe(filho);
    return () => observador.disconnect();
  }, [medir]);

  return (
    <div className="relative flex min-h-0 flex-col">
      <div ref={area} onScroll={medir} className={cn("overflow-y-auto", className)}>
        {children}
      </div>
      {maisAbaixo && (
        <div
          data-testid="mais-conteudo"
          className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center bg-gradient-to-t from-superficie via-superficie/80 to-transparent pt-8 pb-1 text-xs text-texto-suave"
        >
          <span className="inline-flex items-center gap-1">
            <ChevronDown className="size-3.5" aria-hidden /> Role para ver mais
          </span>
        </div>
      )}
    </div>
  );
}
