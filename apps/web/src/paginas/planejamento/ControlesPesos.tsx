import type { CriterioPlanejamento } from "@itree/api-client";

import { Selo } from "../../ui/selo";
import { COR_CRITERIO, PESO_MAXIMO, type CriterioId, type Pesos } from "./calculo";

/** Um controle deslizante de 0 a 5 por critério; o critério sem dado fica desabilitado, com o motivo. */
export function ControlesPesos({
  criterios,
  pesos,
  aoMudar,
}: {
  criterios: CriterioPlanejamento[];
  pesos: Pesos;
  aoMudar: (id: CriterioId, peso: number) => void;
}) {
  return (
    <ul aria-label="Pesos dos critérios" className="flex flex-col gap-3">
      {criterios.map((c) => {
        const id = c.id as CriterioId;
        const desabilitado = !c.disponivel;
        const idControle = `peso-${id}`;
        return (
          <li key={id}>
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={idControle} className="flex items-center gap-1.5 text-sm font-medium">
                <span
                  aria-hidden
                  className="inline-block size-2.5 shrink-0 rounded-sm"
                  style={{ background: COR_CRITERIO[id], opacity: desabilitado ? 0.4 : 1 }}
                />
                <span className={desabilitado ? "text-texto-suave" : undefined}>{c.nome}</span>
                {c.provisorio && <Selo tom="atencao">provisório</Selo>}
              </label>
              <output
                htmlFor={idControle}
                className="w-6 text-right text-sm font-semibold tabular-nums"
              >
                {desabilitado ? "–" : pesos[id]}
              </output>
            </div>
            <input
              id={idControle}
              type="range"
              min={0}
              max={PESO_MAXIMO}
              step={1}
              value={desabilitado ? 0 : pesos[id]}
              disabled={desabilitado}
              aria-valuetext={desabilitado ? "indisponível" : `peso ${pesos[id]} de ${PESO_MAXIMO}`}
              onChange={(e) => aoMudar(id, Number(e.target.value))}
              className="mt-1 w-full accent-marca disabled:opacity-50"
            />
            {desabilitado ? (
              <p className="text-xs text-texto-suave">{c.motivo_indisponivel}</p>
            ) : (
              c.ressalva && <p className="text-xs text-texto-suave">{c.ressalva}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
