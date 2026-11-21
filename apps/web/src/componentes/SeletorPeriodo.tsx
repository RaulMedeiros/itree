import { EntradaData } from "../ui/campos";
import { ATALHOS_PERIODO, type Periodo } from "../util/periodo";

/**
 * "De … até …" com atalhos (30 dias, 12 meses, Ano). Os campos mostram o período efetivo, mesmo
 * quando a pessoa não escolheu um (R3-13): o texto da página e os campos dizem a mesma coisa.
 * Devolve um fragmento, para entrar numa linha de filtros.
 */
export function SeletorPeriodo({
  inicio,
  fim,
  aoMudar,
}: {
  inicio: string;
  fim: string;
  aoMudar: (parcial: Periodo) => void;
}) {
  return (
    <>
      <label className="flex items-center gap-1.5 text-sm text-texto-suave max-md:min-w-0 max-md:flex-1">
        De
        <EntradaData
          value={inicio}
          onChange={(v) => aoMudar({ inicio: v || undefined })}
          className="w-40 max-md:w-full max-md:min-w-0"
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-texto-suave max-md:min-w-0 max-md:flex-1">
        até
        <EntradaData
          value={fim}
          onChange={(v) => aoMudar({ fim: v || undefined })}
          className="w-40 max-md:w-full max-md:min-w-0"
        />
      </label>
      <div
        className="flex items-center gap-1 max-md:w-full max-md:overflow-x-auto max-md:pb-1"
        role="group"
        aria-label="Atalhos de período"
      >
        {ATALHOS_PERIODO.map((a) => (
          <button
            key={a.rotulo}
            type="button"
            onClick={() => aoMudar(a.periodo(new Date()))}
            className="rounded-md border border-borda px-2 py-1 text-xs whitespace-nowrap text-texto-suave hover:border-marca hover:text-marca-escura max-md:min-h-11 max-md:shrink-0 max-md:px-3"
          >
            {a.rotulo}
          </button>
        ))}
      </div>
    </>
  );
}
