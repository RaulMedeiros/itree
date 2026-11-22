import {
  ATRIBUICAO_EDIFICACOES,
  ATRIBUICAO_MACROZONEAMENTO,
  ATRIBUICAO_USO_LOTE,
  COR_EDIFICACAO,
  CORES_MACROZONAS,
  URL_LEGENDA_USO_LOTE,
  ZOOM_EDIFICACOES,
} from "./camadasImoveis";

function Caixa({
  rotulo,
  ativa,
  aoMudar,
  amostra,
}: {
  rotulo: string;
  ativa: boolean;
  aoMudar: (v: boolean) => void;
  amostra: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        className="accent-marca"
        checked={ativa}
        onChange={(e) => aoMudar(e.target.checked)}
      />
      <span className="flex w-4 justify-center" aria-hidden>
        {amostra}
      </span>
      {rotulo}
    </label>
  );
}

/** Controles das três camadas, para o grupo Contexto do painel de camadas. */
export function ControlesImoveis({
  edificacoes,
  usoLote,
  macrozona,
  aoMudar,
  zoom,
}: {
  edificacoes: boolean;
  usoLote: boolean;
  macrozona: boolean;
  aoMudar: (camada: "edificacoes" | "uso_lote" | "macrozona", ativa: boolean) => void;
  zoom: number;
}) {
  return (
    <>
      <Caixa
        rotulo="Edificações"
        ativa={edificacoes}
        aoMudar={(v) => aoMudar("edificacoes", v)}
        amostra={
          <span
            className="inline-block size-3 rounded-[2px]"
            style={{ background: COR_EDIFICACAO }}
          />
        }
      />
      <p className="text-xs text-texto-suave">
        Contornos detectados em imagem de satélite. Aparecem a partir do zoom {ZOOM_EDIFICACOES}.
        Fonte: {ATRIBUICAO_EDIFICACOES}.
      </p>
      {edificacoes && zoom < ZOOM_EDIFICACOES && (
        <p role="status" className="text-xs text-texto-suave">
          Aproxime o mapa para ver as edificações (a partir do zoom {ZOOM_EDIFICACOES}).
        </p>
      )}
      <Caixa
        rotulo="Uso predominante por lote (SEFIN)"
        ativa={usoLote}
        aoMudar={(v) => aoMudar("uso_lote", v)}
        amostra={
          <span className="inline-block size-3 rounded-[2px]" style={{ background: "#fdd8b6" }} />
        }
      />
      <p className="text-xs text-texto-suave">
        Residencial, não residencial, misto ou territorial (regra dos 70% da área edificada), 2022.
        Fonte: {ATRIBUICAO_USO_LOTE}.
      </p>
      <Caixa
        rotulo="Macrozoneamento"
        ativa={macrozona}
        aoMudar={(v) => aoMudar("macrozona", v)}
        amostra={
          <span aria-hidden className="inline-flex h-3 w-4 overflow-hidden rounded-[2px]">
            {CORES_MACROZONAS.slice(0, 4).map(([p, c]) => (
              <span key={p} className="h-full flex-1" style={{ background: c }} />
            ))}
          </span>
        }
      />
      <p className="text-xs text-texto-suave">
        Zonas de ocupação urbana. Fonte: {ATRIBUICAO_MACROZONEAMENTO}.
      </p>
    </>
  );
}

/** Legendas das camadas ligadas (uso por lote com a imagem oficial; zonas por cor). */
export function LegendaImoveis({
  usoLote,
  macrozona,
  edificacoes,
}: {
  usoLote: boolean;
  macrozona: boolean;
  edificacoes: boolean;
}) {
  if (!usoLote && !macrozona && !edificacoes) return null;
  return (
    <section
      aria-label="Legenda de imóveis e uso do solo"
      className="pointer-events-auto shrink-0 rounded-xl border border-borda bg-superficie/95 px-3 py-2 text-xs shadow-lg backdrop-blur max-md:max-h-[45dvh] max-md:overflow-y-auto"
    >
      {usoLote && (
        <div className="max-w-64">
          <p className="font-semibold">Uso predominante por lote, 2022</p>
          <img
            src={URL_LEGENDA_USO_LOTE}
            alt="Legenda do uso por lote: misto, não residencial, residencial e territorial"
            className="mt-1"
            loading="lazy"
          />
          <p className="mt-1 text-texto-suave">Fonte: {ATRIBUICAO_USO_LOTE}.</p>
        </div>
      )}
      {macrozona && (
        <div className="mt-1 max-w-64">
          <p className="font-semibold">Macrozoneamento</p>
          <ul aria-label="Zonas" className="mt-1 flex flex-col gap-1">
            {CORES_MACROZONAS.map(([sigla, c]) => (
              <li key={sigla} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-3 w-5 shrink-0 rounded-[2px] border border-black/20"
                  style={{ background: c }}
                />
                {sigla}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-texto-suave">Fonte: {ATRIBUICAO_MACROZONEAMENTO}.</p>
        </div>
      )}
      {edificacoes && (
        <p className="mt-1 max-w-64 text-texto-suave">
          Edificações: {ATRIBUICAO_EDIFICACOES}. Detecção automática, sem separar casa de comércio.
        </p>
      )}
    </section>
  );
}
