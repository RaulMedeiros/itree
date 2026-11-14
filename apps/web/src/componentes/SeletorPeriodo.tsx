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
      <label className="flex items-center gap-1.5 text-sm text-texto-suave">
        De
        <EntradaData
          value={inicio}
          onChange={(v) => aoMudar({ inicio: v || undefined })}
          className="w-40"
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-texto-suave">
        até
        <EntradaData
          value={fim}
          onChange={(v) => aoMudar({ fim: v || undefined })}
          className="w-40"
        />
      </label>
      <div className="flex items-center gap-1" role="group" aria-label="Atalhos de período">
        {ATALHOS_PERIODO.map((a) => (
          <button
            key={a.rotulo}
            type="button"
            onClick={() => aoMudar(a.periodo(new Date()))}
            className="rounded-md border border-borda px-2 py-1 text-xs text-texto-suave hover:border-marca hover:text-marca-escura"
          >
            {a.rotulo}
          </button>
        ))}
      </div>
    </>
  );
}
