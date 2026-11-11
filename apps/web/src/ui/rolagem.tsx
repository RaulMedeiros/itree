import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "../util/cn";

/**
 * Área com rolagem vertical que avisa quando há conteúdo escondido abaixo
 * (sombra e indicação), para controles cortados pela borda não passarem
 * por "fim do painel" (C-09). A indicação ocupa uma faixa própria sob a área,
 * sem se sobrepor ao título da seção que estiver na borda (R2-06).
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
          className="pointer-events-none flex shrink-0 items-center justify-center gap-1 border-t border-borda/60 bg-superficie py-1 text-xs text-texto-suave shadow-[0_-6px_8px_-6px_rgb(0_0_0/0.18)]"
        >
          <ChevronDown className="size-3.5" aria-hidden /> Role para ver mais
        </div>
      )}
    </div>
  );
}
