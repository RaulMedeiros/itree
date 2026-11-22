import { useDeteccoesLotesMapa } from "@itree/api-client";
import { ROTULOS_RESULTADO_DETECCAO, type ResultadoDeteccao } from "@itree/domain";
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { Mapa } from "../../mapa/Mapa";
import { limitesDosPontos } from "../../mapa/enquadramento";
import { useBaseLembrada } from "../../mapa/useBaseLembrada";
import { Carregando, Erro } from "../../ui/estados";
import {
  CORES_RESULTADO_DETECCAO,
  contarResultados,
  type FeicaoDeteccao,
} from "./resultadoDeteccao";

const porResultado = (padrao: unknown) => [
  "match",
  ["get", "resultado"],
  ...Object.keys(CORES_RESULTADO_DETECCAO).flatMap((k) => [
    k,
    (CORES_RESULTADO_DETECCAO as Record<string, unknown>)[k],
  ]),
  padrao,
];

/**
 * Mapa das detecções de um lote, coloridas por resultado. A legenda traz o rótulo e a contagem de
 * cada resultado, porque a cor sozinha não basta (RNF-A11Y-002).
 */
export function MapaDoLote({ loteId }: { loteId: string }) {
  const consulta = useDeteccoesLotesMapa(loteId);
  const base = useBaseLembrada();
  const mapa = useRef<MapaMapLibre | null>(null);
  const [pronto, setPronto] = useState(false);
  const dados = consulta.data?.data as unknown as
    { type: "FeatureCollection"; features: FeicaoDeteccao[] } | undefined;

  const aoCarregar = (m: MapaMapLibre) => {
    mapa.current = m;
    m.addSource("deteccoes", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    // Recusadas vazadas; possível remoção com anel externo.
    m.addLayer({
      id: "deteccoes-anel",
      type: "circle",
      source: "deteccoes",
      filter: ["==", ["get", "resultado"], "possivel_remocao"],
      paint: {
        "circle-radius": 11,
        "circle-color": "#ffffff",
        "circle-opacity": 0,
        "circle-stroke-color": CORES_RESULTADO_DETECCAO.possivel_remocao,
        "circle-stroke-width": 2.4,
      },
    });
    m.addLayer({
      id: "deteccoes-pontos",
      type: "circle",
      source: "deteccoes",
      paint: {
        "circle-radius": 6,
        "circle-color": porResultado("#868e96") as never,
        "circle-opacity": ["case", ["==", ["get", "resultado"], "recusada"], 0.25, 0.95],
        "circle-stroke-color": porResultado("#868e96") as never,
        "circle-stroke-width": ["case", ["==", ["get", "resultado"], "recusada"], 2, 1.4],
      },
    });
    setPronto(true);
  };

  useEffect(() => {
    const m = mapa.current;
    if (!pronto || !m || !dados) return;
    (m.getSource("deteccoes") as GeoJSONSource | undefined)?.setData(dados as never);
    const caixa = limitesDosPontos(dados.features.map((f) => f.geometry.coordinates));
    if (caixa) m.fitBounds(caixa, { padding: 40, maxZoom: 18, duration: 0 });
  }, [pronto, dados]);

  if (consulta.isPending) return <Carregando linhas={4} />;
  if (consulta.isError) return <Erro erro={consulta.error} />;

  const contagem = contarResultados(dados?.features ?? []);
  return (
    <section aria-label="Mapa do lote" className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-lg border border-borda">
        <Mapa
          base={base}
          rotulo="Detecções do lote no mapa"
          className="h-96"
          aoCarregar={aoCarregar}
        />
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Legenda do mapa do lote">
        {(Object.keys(ROTULOS_RESULTADO_DETECCAO) as ResultadoDeteccao[]).map((r) => (
          <li key={r} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-3 rounded-full"
              style={
                r === "recusada"
                  ? { border: `2px solid ${CORES_RESULTADO_DETECCAO[r]}` }
                  : r === "possivel_remocao"
                    ? {
                        background: CORES_RESULTADO_DETECCAO[r],
                        outline: `2px solid ${CORES_RESULTADO_DETECCAO[r]}`,
                        outlineOffset: 1,
                      }
                    : { background: CORES_RESULTADO_DETECCAO[r] }
              }
            />
            {ROTULOS_RESULTADO_DETECCAO[r]}: <strong>{contagem[r]}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
