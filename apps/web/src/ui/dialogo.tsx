import * as Radix from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../util/cn";

export function Dialogo({
  aberto,
  aoMudar,
  titulo,
  descricao,
  children,
  rodape,
  largura = "max-w-lg",
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  titulo: string;
  descricao?: string;
  children: ReactNode;
  rodape?: ReactNode;
  largura?: string;
}) {
  return (
    <Radix.Root open={aberto} onOpenChange={aoMudar}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-40 bg-texto/40" />
        <Radix.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-superficie shadow-xl",
            largura,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-borda px-5 py-4">
            <div>
              <Radix.Title className="text-base font-semibold">{titulo}</Radix.Title>
              {descricao ? (
                <Radix.Description className="mt-1 text-sm text-texto-suave">
                  {descricao}
                </Radix.Description>
              ) : (
                <Radix.Description className="sr-only">{titulo}</Radix.Description>
              )}
            </div>
            <Radix.Close
              className="rounded-md p-1 text-texto-suave hover:bg-neutro-clara"
              aria-label="Fechar"
            >
              <X className="size-4" />
            </Radix.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {rodape && (
            <div className="flex justify-end gap-2 border-t border-borda px-5 py-3">{rodape}</div>
          )}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
