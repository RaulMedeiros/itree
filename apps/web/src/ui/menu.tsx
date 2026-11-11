import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../util/cn";

export interface ItemMenu {
  rotulo: string;
  aoEscolher: () => void;
  perigo?: boolean;
}

/** Menu "⋯" para ações secundárias, deixando uma só ação principal visível na linha. */
export function MenuAcoes({ rotulo, itens }: { rotulo: string; itens: ItemMenu[] }) {
  if (itens.length === 0) return null;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={rotulo}
        className="inline-flex size-8 items-center justify-center rounded-md border border-borda bg-superficie text-texto hover:bg-neutro-clara"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-48 rounded-md border border-borda bg-superficie p-1 shadow-lg"
        >
          {itens.map((item) => (
            <Menu.Item
              key={item.rotulo}
              onSelect={item.aoEscolher}
              className={cn(
                "cursor-pointer rounded px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-neutro-clara",
                item.perigo && "text-perigo",
              )}
            >
              {item.rotulo}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export interface GrupoMenu {
  titulo: string;
  itens: ItemMenu[];
}

/** Menu com rótulo visível e itens em grupos (por exemplo, exportações por entidade). */
export function MenuAgrupado({
  rotulo,
  icone,
  grupos,
  desabilitado,
}: {
  rotulo: string;
  icone?: ReactNode;
  grupos: GrupoMenu[];
  desabilitado?: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={desabilitado}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-borda bg-superficie px-3.5 font-medium whitespace-nowrap text-texto hover:bg-neutro-clara disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4"
      >
        {icone}
        {rotulo}
        <ChevronDown aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="start"
          sideOffset={4}
          className="z-50 min-w-56 rounded-md border border-borda bg-superficie p-1 shadow-lg"
        >
          {grupos.map((g, n) => (
            <Menu.Group key={g.titulo}>
              {n > 0 && <Menu.Separator className="my-1 h-px bg-borda" />}
              <Menu.Label className="px-2.5 py-1 text-xs font-semibold text-texto-suave">
                {g.titulo}
              </Menu.Label>
              {g.itens.map((item) => (
                <Menu.Item
                  key={item.rotulo}
                  onSelect={item.aoEscolher}
                  className="cursor-pointer rounded px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-neutro-clara"
                >
                  {item.rotulo}
                </Menu.Item>
              ))}
            </Menu.Group>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
