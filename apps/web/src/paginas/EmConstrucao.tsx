import { Construction } from "lucide-react";

import type { Modulo } from "../acesso/modulos";
import { CabecalhoPagina } from "../ui/pagina";

/** Módulos de fases futuras, visíveis apenas fora de produção. */
export function EmConstrucao({ modulo }: { modulo: Modulo }) {
  return (
    <>
      <CabecalhoPagina titulo={modulo.rotulo} />
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-borda bg-superficie px-6 py-12 text-center">
        <Construction className="size-6 text-texto-suave" aria-hidden />
        <p className="font-medium">Módulo previsto para a fase {modulo.fase}</p>
        <p className="max-w-md text-sm text-texto-suave">
          Especificação em <code>docs/specs/web</code> ({modulo.spec}). Este aviso só aparece em
          ambientes de desenvolvimento.
        </p>
      </div>
    </>
  );
}
