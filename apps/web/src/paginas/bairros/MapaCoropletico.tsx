import { indicadoresArborizacaoEntornoGeojson } from "@itree/api-client";
import { useNavigate } from "@tanstack/react-router";
import type { GeoJSONSource, Map as MapaMapLibre, MapLayerMouseEvent } from "maplibre-gl";
import { useRef } from "react";

import { Mapa } from "../../mapa/Mapa";
import {
  COR_POR_VALOR,
  CORES_ARBORIZACAO,
  COR_SEM_DADO,
  FILTRO_COM_DADO,
  FILTRO_SEM_DADO,
  IMAGEM_SEM_DADO,
  OPACIDADE_ARBORIZACAO,
  ROTULOS_CLASSES_ARBORIZACAO,
  registrarHachuraSemDado,
} from "../../mapa/coropletica";

/**
 * Mapa pequeno dos bairros do escopo, pintados pela arborização do entorno (Censo 2022). Clicar
 * em um bairro abre a ficha. Sem dado do Censo, o bairro é hachurado, não zero.
 */
export function MapaCoropletico() {
  const navegar = useNavigate();
  const mapa = useRef<MapaMapLibre | null>(null);

  const aoCarregar = (m: MapaMapLibre) => {
    mapa.current = m;
    registrarHachuraSemDado(m);
    m.addSource("bairros", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({
      id: "bairros-valor",
      type: "fill",
      source: "bairros",
      filter: FILTRO_COM_DADO,
      paint: { "fill-color": COR_POR_VALOR, "fill-opacity": OPACIDADE_ARBORIZACAO },
    });
    m.addLayer({
      id: "bairros-sem-dado",
      type: "fill",
      source: "bairros",
      filter: FILTRO_SEM_DADO,
      paint: { "fill-pattern": IMAGEM_SEM_DADO, "fill-opacity": 0.7 },
    });
    m.addLayer({
      id: "bairros-contorno",
      type: "line",
      source: "bairros",
      paint: { "line-color": "#243b53", "line-width": 0.8, "line-opacity": 0.7 },
    });
    for (const camada of ["bairros-valor", "bairros-sem-dado"]) {
      m.on("mouseenter", camada, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", camada, () => (m.getCanvas().style.cursor = ""));
      m.on("click", camada, (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") void navegar({ to: "/bairros/$id", params: { id } });
      });
    }
    void indicadoresArborizacaoEntornoGeojson({ precisao: 4 }).then(({ data }) => {
      (m.getSource("bairros") as GeoJSONSource | undefined)?.setData(
        data as unknown as Parameters<GeoJSONSource["setData"]>[0],
      );
    });
  };

  return (
    <section
      aria-label="Mapa dos bairros pela arborização do entorno"
      className="overflow-hidden rounded-xl border border-borda bg-superficie"
    >
      <div className="px-4 pt-3">
        <h2 className="font-semibold">Arborização do entorno (Censo 2022)</h2>
        <p className="text-xs text-texto-suave">
          Faces de quadra com árvore, por bairro. Percepção do recenseador; não mede copa. Clique em
          um bairro para abrir a ficha.
        </p>
      </div>
      <Mapa
        base="ruas"
        rotulo="Mapa dos bairros pela arborização do entorno"
        className="mt-2 h-72"
        aoCarregar={aoCarregar}
      />
      <ul
        aria-label="Legenda da arborização do entorno"
        className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2.5 text-xs text-texto-suave"
      >
        {ROTULOS_CLASSES_ARBORIZACAO.map((rotulo, i) => (
          <li key={rotulo} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-3 rounded-sm ring-1 ring-black/10"
              style={{ background: CORES_ARBORIZACAO[i] }}
            />
            {rotulo}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-3 rounded-sm ring-1 ring-black/10"
            style={{
              background: `repeating-linear-gradient(135deg, ${COR_SEM_DADO} 0 2px, transparent 2px 5px)`,
            }}
          />
          Sem dado
        </li>
      </ul>
    </section>
  );
}
