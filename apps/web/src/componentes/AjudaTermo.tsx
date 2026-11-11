import { Link } from "@tanstack/react-router";
import { CircleHelp } from "lucide-react";
import { useState } from "react";

import { TERMOS, type IdTermo } from "../ajuda/glossario";
import { Dialogo } from "../ui/dialogo";
import { cn } from "../util/cn";
import { DetalhesTecnicos } from "./DetalhesTecnicos";

/** Ícone "?" ao lado de um termo do domínio: abre a definição do glossário (G-06). */
export function AjudaTermo({ id, className }: { id: IdTermo; className?: string }) {
  const [aberto, setAberto] = useState(false);
  const termo = TERMOS[id];
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={`O que é ${termo.termo.toLocaleLowerCase("pt-BR")}?`}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-texto-suave hover:text-marca-escura",
          className,
        )}
      >
        <CircleHelp className="size-4" aria-hidden />
      </button>
      {aberto && (
        <Dialogo
          aberto
          aoMudar={setAberto}
          titulo={termo.termo}
          largura="max-w-md"
          rodape={
            <Link
              to="/ajuda"
              hash={id}
              onClick={() => setAberto(false)}
              className="text-sm font-medium text-marca-escura hover:underline"
            >
              Ver o glossário completo
            </Link>
          }
        >
          <p className="text-sm">{termo.definicao}</p>
          <DetalhesTecnicos>Regras de origem: {termo.regras.join(", ")}.</DetalhesTecnicos>
        </Dialogo>
      )}
    </>
  );
}
