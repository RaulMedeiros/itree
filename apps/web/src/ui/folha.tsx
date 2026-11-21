import * as Radix from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { cn } from "../util/cn";

/**
 * Gaveta lateral (menu no celular): diálogo modal do Radix, com foco preso,
 * Esc para fechar e devolução do foco ao botão que a abriu.
 */
export function Gaveta({
  aberta,
  aoMudar,
  titulo,
  children,
  className,
  devolverFoco,
}: {
  aberta: boolean;
  aoMudar: (aberta: boolean) => void;
  titulo: string;
  children: ReactNode;
  className?: string;
  /** Botão que abriu a gaveta: recebe o foco de volta ao fechar. */
  devolverFoco?: RefObject<HTMLElement | null>;
}) {
  return (
    <Radix.Root open={aberta} onOpenChange={aoMudar}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-40 bg-texto/50" />
        <Radix.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            devolverFoco?.current?.focus();
          }}
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-hidden bg-barra text-barra-texto shadow-xl",
            className,
          )}
        >
          <Radix.Title className="sr-only">{titulo}</Radix.Title>
          <Radix.Close
            aria-label="Fechar menu"
            className="absolute top-2 right-2 z-10 flex size-11 items-center justify-center rounded-md text-barra-suave hover:bg-white/10 focus-visible:outline-white"
          >
            <X className="size-5" aria-hidden />
          </Radix.Close>
          {children}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

/**
 * Folha que sobe da borda inferior (filtros no celular): modal, com alça,
 * título e botão de fechar de 44 px. Rola por dentro quando o conteúdo é alto.
 */
export function FolhaInferior({
  aberta,
  aoMudar,
  titulo,
  descricao,
  children,
  rodape,
}: {
  aberta: boolean;
  aoMudar: (aberta: boolean) => void;
  titulo: string;
  descricao?: string;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  return (
    <Radix.Root open={aberta} onOpenChange={aoMudar}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-40 bg-texto/40" />
        <Radix.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl bg-superficie shadow-xl">
          <div aria-hidden className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-borda" />
          <div className="flex items-center justify-between gap-3 border-b border-borda py-1 pr-1 pl-4">
            <Radix.Title className="text-base font-semibold">{titulo}</Radix.Title>
            <Radix.Close
              aria-label="Fechar"
              className="flex size-11 items-center justify-center rounded-md text-texto-suave hover:bg-neutro-clara"
            >
              <X className="size-5" aria-hidden />
            </Radix.Close>
          </div>
          <Radix.Description
            className={descricao ? "px-4 pt-2 text-sm text-texto-suave" : "sr-only"}
          >
            {descricao ?? titulo}
          </Radix.Description>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {rodape && <div className="flex gap-2 border-t border-borda px-4 py-3">{rodape}</div>}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
