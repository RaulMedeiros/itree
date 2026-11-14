import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { ChevronDown, CircleHelp, LogOut, UserRound } from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ROTULOS_PAPEL } from "@itree/domain";
import { useAuth } from "react-oidc-context";

import { useUsuario } from "../acesso/ContextoUsuario";
import { moduloAtivo, modulosVisiveis } from "../acesso/modulos";
import { config } from "../config";
import { Selo } from "../ui/selo";
import { cn } from "../util/cn";
import { BuscaGlobal } from "./BuscaGlobal";
import { FontesIndicador } from "./FontesIndicador";
import { SeletorTerritorio } from "./SeletorTerritorio";
import { Sino } from "./Sino";

export function Shell() {
  const eu = useUsuario();
  const modulos = modulosVisiveis(eu.permissoes, config.mostrarModulosFuturos);
  const caminho = useRouterState({ select: (e) => e.location.pathname });
  const ativo = moduloAtivo(modulos, caminho);
  const principal = useRef<HTMLElement>(null);

  // Quem rola agora é o <main>, não a janela: ao trocar de página, volta ao topo
  // como a janela voltaria.
  useEffect(() => {
    principal.current?.scrollTo?.({ top: 0 });
  }, [caminho]);

  // Altura limitada à janela (R3-01): a faixa de demonstração e o cabeçalho
  // ficam com a altura própria, a área de conteúdo ocupa o restante e rola por
  // dentro. Assim o mapa cabe na janela com ou sem a faixa, sem `calc` fixo.
  return (
    <div data-testid="shell" className="flex h-dvh flex-col overflow-hidden">
      {eu.ambiente === "demonstracao" && (
        <div
          role="note"
          className="shrink-0 bg-atencao px-4 py-1.5 text-center text-sm font-medium text-white"
        >
          Dados de demonstração — não representam a realidade.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col overflow-y-auto bg-barra text-barra-texto">
          <Link to="/" className="flex items-center gap-2.5 border-b border-white/10 px-4 py-4">
            <img src="/icone.svg" alt="" className="size-8 rounded-md bg-white p-0.5" />
            <span className="text-sm leading-tight font-semibold">
              Engine de Inteligência
              <br />
              Arbórea
            </span>
          </Link>
          <nav aria-label="Navegação principal" className="flex flex-col gap-0.5 p-3">
            {modulos.map((m) => (
              <Link
                key={m.id}
                to={m.caminho}
                aria-current={ativo === m.id ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-barra-suave hover:bg-white/10 hover:text-barra-texto focus-visible:outline-white",
                  ativo === m.id &&
                    "bg-barra-ativo font-medium text-barra-texto! before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r before:bg-barra-realce",
                )}
              >
                <m.icone className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">{m.rotulo}</span>
                {!m.entregue && <span className="text-[11px] text-barra-suave">{m.fase}</span>}
              </Link>
            ))}
          </nav>
          <nav aria-label="Ajuda" className="mt-auto border-t border-white/10 p-3">
            <Link
              to="/ajuda"
              className="relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-barra-suave hover:bg-white/10 hover:text-barra-texto focus-visible:outline-white"
              activeProps={{ className: "bg-barra-ativo font-medium text-barra-texto!" }}
            >
              <CircleHelp className="size-4 shrink-0" aria-hidden />
              <span className="flex-1">Ajuda</span>
            </Link>
          </nav>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Cabecalho />
          <main ref={principal} className="min-h-0 flex-1 overflow-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function Cabecalho() {
  const eu = useUsuario();
  const auth = useAuth();
  const navegar = useNavigate();

  return (
    // Três colunas (R3-33): a busca fica no centro e não muda de lugar com o
    // tamanho do nome do usuário.
    <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-borda bg-superficie px-6">
      <div className="min-w-0 justify-self-start">
        <SeletorTerritorio />
      </div>
      <BuscaGlobal />
      <div className="flex items-center gap-2 justify-self-end">
        <FontesIndicador />
        <Sino />
        <Menu.Root>
          <Menu.Trigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-fundo">
            <span className="flex size-7 items-center justify-center rounded-full bg-marca-clara text-xs font-semibold text-marca-escura">
              {(eu.nome || eu.email).slice(0, 1).toUpperCase()}
            </span>
            <span className="max-w-48 truncate">{eu.nome || eu.email}</span>
            <ChevronDown className="size-4 text-texto-suave" aria-hidden />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              align="end"
              sideOffset={6}
              className="z-50 w-64 rounded-md border border-borda bg-superficie p-1 shadow-lg"
            >
              <div className="px-2.5 py-2">
                <p className="truncate text-sm font-medium">{eu.nome || eu.email}</p>
                <p className="truncate text-xs text-texto-suave">{eu.email}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {eu.papeis.map((p) => (
                    <Selo key={p} tom="marca">
                      {ROTULOS_PAPEL[p]}
                    </Selo>
                  ))}
                </div>
              </div>
              <Menu.Separator className="my-1 h-px bg-borda" />
              <Menu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-sm outline-none data-highlighted:bg-marca-clara data-highlighted:outline-2 data-highlighted:outline-marca"
                onSelect={() => void navegar({ to: "/minha-conta" })}
              >
                <UserRound className="size-4" aria-hidden /> Minha conta
              </Menu.Item>
              <Menu.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-sm outline-none data-highlighted:bg-marca-clara data-highlighted:outline-2 data-highlighted:outline-marca"
                onSelect={() => void auth.signoutRedirect()}
              >
                <LogOut className="size-4" aria-hidden /> Sair
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </header>
  );
}
