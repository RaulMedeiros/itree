import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapaMapLibre,
  MapLayerMouseEvent,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { Mapa } from "../../mapa/Mapa";
import {
  COR_SEM_DADO,
  IMAGEM_SEM_DADO,
  filtroComDado,
  filtroSemDado,
  registrarHachuraSemDado,
} from "../../mapa/coropletica";
import {
  COR_SELECAO_PRIORIDADE,
  CORES_PRIORIDADE,
  OPACIDADE_PRIORIDADE,
  ROTULOS_CLASSES_PRIORIDADE,
} from "../../mapa/prioridade";
import { CLASSES, formatarPontuacao, type LinhaPontuada } from "./calculo";

export interface BairroGeometria {
  id: string;
  geometry: unknown;
}

const COR_POR_CLASSE: ExpressionSpecification = [
  "match",
  ["get", "classe"],
  ...CORES_PRIORIDADE.flatMap((cor, i) => [i, cor]),
  CORES_PRIORIDADE[0],
] as unknown as ExpressionSpecification;

const FILTRO_SELECAO = (id: string): ExpressionSpecification => ["==", ["get", "id"], id];

/**
 * Mapa dos bairros pintados pela prioridade do cenário aberto (5 classes, quintis do ranking).
 * Bairro sem nenhum critério ativo com dado é hachurado, nunca pintado como prioridade baixa.
 */
export function MapaPrioridade({
  geometrias,
  linhas,
  classes,
  faixas,
  selecionado,
  aoSelecionar,
}: {
  geometrias: BairroGeometria[];
  linhas: LinhaPontuada[];
  classes: Map<string, number>;
  faixas: ({ de: number; ate: number } | null)[];
  selecionado?: string;
  aoSelecionar: (id: string) => void;
}) {
  const [mapa, setMapa] = useState<MapaMapLibre | null>(null);
  const aoSelecionarRef = useRef(aoSelecionar);
  useEffect(() => {
    aoSelecionarRef.current = aoSelecionar;
  }, [aoSelecionar]);

  const dados = useMemo(() => {
    const porId = new Map(linhas.map((l) => [l.id, l]));
    return {
      type: "FeatureCollection" as const,
      features: geometrias
        .filter((g) => porId.has(g.id))
        .map((g) => {
          const l = porId.get(g.id)!;
          return {
            type: "Feature" as const,
            geometry: g.geometry,
            properties: {
              id: g.id,
              nome: l.nome,
              classe: classes.get(g.id) ?? null,
              pontuacao: l.pontuacao,
            },
          };
        }),
    };
  }, [geometrias, linhas, classes]);

  const aoCarregar = (m: MapaMapLibre) => {
    registrarHachuraSemDado(m);
    m.addSource("prioridade", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    m.addLayer({
      id: "prioridade-preenchimento",
      type: "fill",
      source: "prioridade",
      filter: filtroComDado("classe"),
      paint: { "fill-color": COR_POR_CLASSE, "fill-opacity": OPACIDADE_PRIORIDADE },
    });
    m.addLayer({
      id: "prioridade-sem-dado",
      type: "fill",
      source: "prioridade",
      filter: filtroSemDado("classe"),
      paint: { "fill-pattern": IMAGEM_SEM_DADO, "fill-opacity": 0.7 },
    });
    m.addLayer({
      id: "prioridade-contorno",
      type: "line",
      source: "prioridade",
      paint: { "line-color": "#243b53", "line-width": 0.8, "line-opacity": 0.7 },
    });
    m.addLayer({
      id: "prioridade-selecao",
      type: "line",
      source: "prioridade",
      filter: FILTRO_SELECAO(""),
      paint: { "line-color": COR_SELECAO_PRIORIDADE, "line-width": 3 },
    });
    for (const camada of ["prioridade-preenchimento", "prioridade-sem-dado"]) {
      m.on("mouseenter", camada, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", camada, () => (m.getCanvas().style.cursor = ""));
      m.on("click", camada, (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") aoSelecionarRef.current(id);
      });
    }
    setMapa(m);
  };

  useEffect(() => {
    (mapa?.getSource("prioridade") as GeoJSONSource | undefined)?.setData(
      dados as unknown as Parameters<GeoJSONSource["setData"]>[0],
    );
  }, [mapa, dados]);

  useEffect(() => {
    mapa?.setFilter("prioridade-selecao", FILTRO_SELECAO(selecionado ?? ""));
  }, [mapa, selecionado]);

  const haSemPontuacao = linhas.some((l) => l.pontuacao === null);

  return (
    <section
      aria-label="Mapa da prioridade para plantio"
      className="overflow-hidden rounded-xl border border-borda bg-superficie"
    >
      <Mapa
        base="ruas"
        rotulo="Mapa da prioridade para plantio por bairro"
        className="h-[26rem] lg:h-[32rem]"
        aoCarregar={aoCarregar}
      />
      <ul
        aria-label="Legenda da prioridade para plantio"
        className="grid gap-x-4 gap-y-1 px-4 py-3 text-xs text-texto-suave sm:grid-cols-2"
      >
        {Array.from({ length: CLASSES }, (_, i) => CLASSES - 1 - i).map((c) => (
          <li key={c} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-3 shrink-0 rounded-sm ring-1 ring-black/10"
              style={{ background: CORES_PRIORIDADE[c] }}
            />
            <span>
              {ROTULOS_CLASSES_PRIORIDADE[c]}
              {faixas[c] && (
                <span className="tabular-nums">
                  {" "}
                  · pontuação {formatarPontuacao(faixas[c]!.de)} a{" "}
                  {formatarPontuacao(faixas[c]!.ate)}
                </span>
              )}
            </span>
          </li>
        ))}
        {haSemPontuacao && (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-3 shrink-0 rounded-sm ring-1 ring-black/10"
              style={{
                background: `repeating-linear-gradient(135deg, ${COR_SEM_DADO} 0 2px, transparent 2px 5px)`,
              }}
            />
            Sem dado nos critérios ativos
          </li>
        )}
      </ul>
    </section>
  );
}
