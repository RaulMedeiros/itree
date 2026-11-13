import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { createContext, useContext, type ComponentPropsWithRef } from "react";

import { cn } from "../util/cn";

const variantes = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      variante: {
        primario: "bg-marca text-white hover:bg-marca-escura",
        secundario: "border border-borda bg-superficie text-texto hover:bg-neutro-clara",
        fantasma: "text-texto hover:bg-neutro-clara",
        perigo: "bg-perigo text-white hover:bg-perigo/90",
        // Ação destrutiva secundária: não compete com a principal.
        perigoContorno: "border border-perigo/40 bg-superficie text-perigo hover:bg-perigo-clara",
      },
      tamanho: {
        normal: "h-9 px-3.5",
        pequeno: "h-8 px-2.5 text-[13px]",
        icone: "size-9",
      },
    },
    defaultVariants: { variante: "primario", tamanho: "normal" },
  },
);

type Props = ComponentPropsWithRef<"button"> &
  VariantProps<typeof variantes> & { asChild?: boolean };

/**
 * Dentro de uma linha de formulário (`LinhaFormulario`) o botão tem a mesma
 * altura dos campos ao lado: `pequeno` só vale em linhas de tabela e cartões (R3-07).
 */
export const ContextoLinhaFormulario = createContext(false);

export function Botao({ className, variante, tamanho, asChild, type, ...props }: Props) {
  const Componente = asChild ? Slot : "button";
  const noFormulario = useContext(ContextoLinhaFormulario);
  const tamanhoEfetivo = noFormulario && tamanho === "pequeno" ? "normal" : tamanho;
  return (
    <Componente
      type={asChild ? undefined : (type ?? "button")}
      className={cn(variantes({ variante, tamanho: tamanhoEfetivo }), className)}
      {...props}
    />
  );
}
