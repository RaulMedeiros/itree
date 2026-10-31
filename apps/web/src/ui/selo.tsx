import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "../util/cn";

/** Selo de estado: cor sempre acompanhada de texto (RNF-A11Y-002). */
const variantes = cva(
  "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tom: {
        neutro: "bg-neutro-clara text-neutro",
        marca: "bg-marca-clara text-marca-escura",
        info: "bg-info-clara text-info",
        atencao: "bg-atencao-clara text-atencao",
        perigo: "bg-perigo-clara text-perigo",
        sucesso: "bg-sucesso-clara text-sucesso",
      },
    },
    defaultVariants: { tom: "neutro" },
  },
);

export function Selo({
  className,
  tom,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof variantes>) {
  return <span className={cn(variantes({ tom }), className)} {...props} />;
}
