import { ROTULOS_CONDICAO } from "@itree/domain";

import { CORES_CONDICAO } from "../mapa/simbologia";

/** Ponto na cor do mapa mais o texto: a condição nunca depende só da cor (RNF-A11Y-002). */
export function CondicaoAparente({ condicao }: { condicao?: string }) {
  const chave = (
    condicao && condicao in ROTULOS_CONDICAO ? condicao : "nao_avaliada"
  ) as keyof typeof ROTULOS_CONDICAO;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        className="size-2.5 rounded-full"
        style={{ backgroundColor: CORES_CONDICAO[chave] }}
      />
      <span className={chave === "nao_avaliada" ? "text-texto-suave" : undefined}>
        {ROTULOS_CONDICAO[chave]}
      </span>
    </span>
  );
}
