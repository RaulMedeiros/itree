import type { HTMLAttributes } from "react";

import { cn } from "../util/cn";

/**
 * Aparência única dos códigos de registro ("ARV-000058", "OCO-000014"): mesma
 * fonte, tamanho e cor em listas, cartões e links (R3-06). Para um `<Link>`,
 * use esta classe; para texto solto, use `<Codigo>`.
 */
export const classeCodigo = "font-mono text-[13px] font-medium text-marca-escura";

export function Codigo({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn(classeCodigo, className)} {...props} />;
}

/**
 * Número ou medida com unidade ("40 cm", "6,8 m"): na fonte do texto, com
 * algarismos de largura fixa para alinhar colunas. Nunca em monoespaçada (R3-06).
 */
export function Medida({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("tabular-nums", className)} {...props} />;
}
