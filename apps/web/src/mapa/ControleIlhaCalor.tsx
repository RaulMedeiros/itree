import { ATRIBUICAO_ILHA_CALOR, DEFINICAO_ILHA_CALOR, URL_LEGENDA_ILHA_CALOR } from "./ilhaCalor";

/** Amostra da rampa da camada (azul, amarelo, vermelho), como a legenda oficial. */
export function AmostraIlhaCalor() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-4 rounded-[2px]"
      style={{ background: "linear-gradient(90deg, #3288bd, #fee08b, #d53e4f)" }}
    />
  );
}

/**
 * Camada "Ilha de calor (UrbVerde)" no grupo Contexto: caixa de seleção (desligada por padrão),
 * opacidade ajustável e a atribuição da fonte. O raster só é pedido depois que a camada é ligada.
 */
export function ControleIlhaCalor({
  ativa,
  aoMudar,
  opacidade,
  aoMudarOpacidade,
}: {
  ativa: boolean;
  aoMudar: (ativa: boolean) => void;
  /** 0 a 1. */
  opacidade: number;
  aoMudarOpacidade: (opacidade: number) => void;
}) {
  return (
    <>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-marca"
          checked={ativa}
          onChange={(e) => aoMudar(e.target.checked)}
        />
        <span className="flex w-4 justify-center">
          <AmostraIlhaCalor />
        </span>
        Ilha de calor (UrbVerde)
      </label>
      <p className="text-xs text-texto-suave">
        Temperatura de superfície em relação à mediana de Fortaleza, 2025. Fonte:{" "}
        {ATRIBUICAO_ILHA_CALOR}.
      </p>
      {ativa && (
        <label className="flex items-center gap-2 text-xs text-texto-suave">
          Opacidade
          <input
            type="range"
            min={20}
            max={100}
            step={5}
            value={Math.round(opacidade * 100)}
            aria-label="Opacidade da ilha de calor"
            className="flex-1 accent-marca"
            onChange={(e) => aoMudarOpacidade(Number(e.target.value) / 100)}
          />
          <span className="w-9 text-right tabular-nums">{Math.round(opacidade * 100)}%</span>
        </label>
      )}
    </>
  );
}

/** Bloco da legenda: a imagem oficial (GetLegendGraphic), a definição e a atribuição. */
export function LegendaIlhaCalor() {
  return (
    <div data-testid="legenda-ilha-calor" className="max-w-64">
      <p className="font-semibold">Ilha de calor (UrbVerde), 2025</p>
      <div className="mt-1 flex items-start gap-2">
        <img
          src={URL_LEGENDA_ILHA_CALOR}
          alt="Legenda da ilha de calor: de -5 °C ou menos (azul) a +5 °C ou mais (vermelho); cinza, sem medição"
          width={57}
          height={107}
          className="shrink-0"
          loading="lazy"
        />
        <p className="text-texto-suave">{DEFINICAO_ILHA_CALOR}</p>
      </div>
      <p className="mt-1 text-texto-suave">Fonte: {ATRIBUICAO_ILHA_CALOR}.</p>
    </div>
  );
}
