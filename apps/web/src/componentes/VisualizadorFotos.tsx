import type { FotoArvore } from "@itree/api-client";
import * as Radix from "@radix-ui/react-dialog";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { KeyboardEvent } from "react";

import { formatarData, formatarDataHora } from "../util/formatos";
import { altDaFoto, destinoDaOrigem, rotuloOrigem } from "./galeriaArvore";
import { SeloIlustracao } from "./selos";

/**
 * Visualizador em tela cheia: setas e teclado (← →, Esc), foco preso no diálogo (Radix) e a
 * data, a origem, o autor e a legenda da foto. `indice` nulo = fechado.
 */
export function VisualizadorFotos({
  fotos,
  indice,
  codigoArvore,
  aoMudar,
}: {
  fotos: readonly FotoArvore[];
  indice: number | null;
  codigoArvore: string;
  aoMudar: (indice: number | null) => void;
}) {
  const foto = indice === null ? undefined : fotos[indice];
  const ir = (delta: number) => {
    if (indice === null) return;
    const novo = indice + delta;
    if (novo >= 0 && novo < fotos.length) aoMudar(novo);
  };
  const aoTeclar = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      ir(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      ir(1);
    }
  };
  const destino = foto ? destinoDaOrigem(foto) : null;
  return (
    <Radix.Root open={foto !== undefined} onOpenChange={(v) => !v && aoMudar(null)}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-40 bg-black/90" />
        <Radix.Content
          onKeyDown={aoTeclar}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
        >
          {foto && indice !== null && (
            <>
              <header className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <Radix.Title className="truncate text-base font-semibold">
                    {foto.descricao || `Foto de ${formatarData(foto.data)}`}
                  </Radix.Title>
                  <Radix.Description className="text-sm text-white/80">
                    Foto {indice + 1} de {fotos.length}. Use as setas do teclado para navegar e Esc
                    para fechar.
                  </Radix.Description>
                </div>
                <Radix.Close
                  className="rounded-md p-2 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
                  aria-label="Fechar visualizador"
                >
                  <X className="size-5" aria-hidden />
                </Radix.Close>
              </header>
              <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
                <BotaoSeta
                  rotulo="Foto anterior"
                  desativado={indice === 0}
                  aoClicar={() => ir(-1)}
                  lado="esquerda"
                />
                <img
                  src={foto.url ?? foto.url_miniatura ?? undefined}
                  alt={altDaFoto(foto, codigoArvore)}
                  className="max-h-full max-w-full object-contain"
                />
                <BotaoSeta
                  rotulo="Próxima foto"
                  desativado={indice === fotos.length - 1}
                  aoClicar={() => ir(1)}
                  lado="direita"
                />
              </div>
              <footer className="flex flex-wrap items-center gap-x-6 gap-y-1 bg-black/60 px-4 py-3 text-sm">
                <p>
                  <span className="text-white/70">Data: </span>
                  {formatarDataHora(foto.data)}
                </p>
                <p>
                  <span className="text-white/70">Origem: </span>
                  {destino ? (
                    <Link
                      to={destino.to}
                      params={destino.params}
                      className="underline"
                      onClick={() => aoMudar(null)}
                    >
                      {rotuloOrigem(foto)}
                    </Link>
                  ) : (
                    rotuloOrigem(foto)
                  )}
                </p>
                <p>
                  <span className="text-white/70">Autor: </span>
                  {foto.autor || "não informado"}
                </p>
                <p className="min-w-0 flex-1">
                  <span className="text-white/70">Legenda: </span>
                  {foto.descricao || "sem legenda"}
                </p>
                {foto.ilustrativa && <SeloIlustracao />}
              </footer>
            </>
          )}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

function BotaoSeta({
  rotulo,
  desativado,
  aoClicar,
  lado,
}: {
  rotulo: string;
  desativado: boolean;
  aoClicar: () => void;
  lado: "esquerda" | "direita";
}) {
  const Icone = lado === "esquerda" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={rotulo}
      disabled={desativado}
      onClick={aoClicar}
      className={`absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 p-2 hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-30 ${lado === "esquerda" ? "left-3" : "right-3"}`}
    >
      <Icone className="size-6" aria-hidden />
    </button>
  );
}
