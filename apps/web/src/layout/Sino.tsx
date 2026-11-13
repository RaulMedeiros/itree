import {
  useNotificacoesAgrupadas,
  useNotificacoesContar,
  useNotificacoesLerGrupo,
  useNotificacoesLerTodas,
  type GrupoNotificacoes,
} from "@itree/api-client";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useState } from "react";

import { invalidarCaminhos } from "../util/cache";
import { destinoDoLink } from "../util/filtros";
import { cn } from "../util/cn";
import { formatarDataHora, plural } from "../util/formatos";

const ULTIMAS = 8;

/** Sino do cabeçalho (RF-SHELL-002): ícone neutro, com contador só quando há não lidas. */
export function Sino() {
  const [aberto, setAberto] = useState(false);
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const contagem = useNotificacoesContar({
    query: { refetchInterval: 60_000, staleTime: 30_000 },
  });
  const lista = useNotificacoesAgrupadas({ limite: ULTIMAS }, { query: { enabled: aberto } });
  const atualizar = () => invalidarCaminhos(cliente, "/api/v1/notificacoes");
  const lerGrupo = useNotificacoesLerGrupo({ mutation: { onSuccess: atualizar } });
  const lerTodas = useNotificacoesLerTodas({ mutation: { onSuccess: atualizar } });

  const naoLidas = contagem.data?.data.nao_lidas ?? 0;
  const itens = lista.data?.data ?? [];

  const abrirItem = (g: GrupoNotificacoes) => {
    if (!g.lida) lerGrupo.mutate({ data: { tipo: g.tipo, dia: g.dia } });
    if (g.link) void navegar(destinoDoLink(g.link));
  };

  return (
    <Menu.Root open={aberto} onOpenChange={setAberto}>
      <Menu.Trigger
        aria-label={naoLidas > 0 ? `Notificações: ${plural(naoLidas, "não lida")}` : "Notificações"}
        className="relative flex size-9 items-center justify-center rounded-md hover:bg-fundo"
      >
        <Bell className="size-5 text-texto-suave" aria-hidden />
        {naoLidas > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex min-w-4.5 items-center justify-center rounded-full bg-perigo px-1 text-[11px] leading-4.5 font-semibold text-white"
          >
            {naoLidas > 99 ? "99+" : naoLidas}
          </span>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-96 max-w-[calc(100vw-2rem)] rounded-md border border-borda bg-superficie shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-borda px-3 py-2">
            <p className="text-sm font-semibold">Notificações</p>
            {/* Menu.Item (e não <button>): só ele entra na navegação por setas do menu. */}
            <Menu.Item
              disabled={naoLidas === 0 || lerTodas.isPending}
              onSelect={(e) => {
                // Mantém o menu aberto para a pessoa ver as notificações já marcadas.
                e.preventDefault();
                lerTodas.mutate();
              }}
              className="cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium text-marca-escura outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-marca-clara"
            >
              Marcar todas como lidas
            </Menu.Item>
          </div>
          <div className="max-h-96 overflow-y-auto p-1">
            {lista.isError ? (
              <p role="alert" className="px-3 py-4 text-sm text-perigo">
                Não foi possível carregar as notificações.
              </p>
            ) : lista.isPending ? (
              <p className="px-3 py-4 text-sm text-texto-suave">Carregando…</p>
            ) : itens.length === 0 ? (
              <p className="px-3 py-4 text-sm text-texto-suave">Nada novo por aqui.</p>
            ) : (
              itens.map((n) => (
                <Menu.Item
                  key={`${n.tipo}-${n.dia}`}
                  onSelect={() => abrirItem(n)}
                  className="flex cursor-pointer gap-2 rounded-sm px-2.5 py-2 text-sm outline-none data-highlighted:bg-marca-clara"
                >
                  <span
                    aria-hidden
                    className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.lida ? "" : "bg-marca")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block", !n.lida && "font-medium")}>
                      {n.titulo}
                      {!n.lida && <span className="sr-only"> (não lida)</span>}
                    </span>
                    {n.texto && (
                      <span className="block truncate text-xs text-texto-suave">{n.texto}</span>
                    )}
                    <span className="block text-xs text-texto-suave">
                      {formatarDataHora(n.ultima_em)}
                    </span>
                  </span>
                </Menu.Item>
              ))
            )}
          </div>
          <div className="border-t border-borda p-1">
            <Menu.Item asChild>
              <Link
                to="/notificacoes"
                className="block rounded-sm px-2.5 py-2 text-center text-sm font-medium text-marca-escura outline-none data-highlighted:bg-marca-clara"
              >
                Ver todas
              </Link>
            </Menu.Item>
          </div>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
