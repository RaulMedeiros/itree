import { ROTULOS_CONTAGEM, rotuloContagem, type Contagem } from "@itree/domain";

import { cn } from "../util/cn";

/**
 * "Contar: todas | só confirmadas". A escolha vai na URL (`?contagem=`) e a API aplica o filtro
 * nos indicadores (parâmetro `contagem`). Árvores detectadas automaticamente entram no inventário
 * sem revisão; este filtro deixa ver os números só com as confirmadas.
 */
export function SeletorContagem({
  valor,
  aoMudar,
  className,
}: {
  valor: Contagem;
  aoMudar: (v: Contagem) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Contar"
      className={cn("inline-flex items-center gap-2 text-sm", className)}
    >
      <span className="text-texto-suave">Contar:</span>
      <div className="inline-flex overflow-hidden rounded-md border border-borda">
        {(Object.keys(ROTULOS_CONTAGEM) as Contagem[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={valor === c}
            onClick={() => valor !== c && aoMudar(c)}
            className={cn(
              "px-2.5 py-1 text-sm whitespace-nowrap max-md:min-h-11",
              valor === c ? "bg-marca-clara font-medium text-marca-escura" : "hover:bg-fundo",
            )}
          >
            {c === "todas" ? "Todas" : "Só confirmadas"}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "1.234 árvores (567 confirmadas)". */
export function ContagemDeArvores({
  total,
  confirmadas,
  className,
}: {
  total: number;
  confirmadas: number;
  className?: string;
}) {
  return <span className={className}>{rotuloContagem(total, confirmadas)}</span>;
}
