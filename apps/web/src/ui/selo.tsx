import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "../util/cn";

/** Selo de estado: cor sempre acompanhada de texto (RNF-A11Y-002). */
const variantes = cva("inline-flex items-center gap-1 rounded-sm font-medium whitespace-nowrap", {
  variants: {
    // Dois tamanhos só: `sm` em listas e tabelas, `md` no topo de um detalhe (R3-05).
    tamanho: {
      sm: "px-1.5 py-0.5 text-xs",
      md: "px-2.5 py-1 text-sm",
    },
    tom: {
      neutro: "bg-neutro-clara text-neutro",
      marca: "bg-marca-clara text-marca-escura",
      info: "bg-info-clara text-info",
      atencao: "bg-atencao-clara text-atencao",
      // Alerta ambiental: o violeta do losango no mapa.
      alerta: "bg-alerta-clara text-alerta",
      perigo: "bg-perigo-clara text-perigo",
      sucesso: "bg-sucesso-clara text-sucesso",
    },
  },
  defaultVariants: { tom: "neutro", tamanho: "sm" },
});

export function Selo({
  className,
  tom,
  tamanho,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof variantes>) {
  return <span className={cn(variantes({ tom, tamanho }), className)} {...props} />;
}
