import { territoriosGeojson, useMapaCamadas } from "@itree/api-client";
import { ROTULOS_CONDICAO } from "@itree/domain";
import { Link } from "@tanstack/react-router";
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";
import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Mapa } from "../../mapa/Mapa";
import { limitesDosPontos } from "../../mapa/enquadramento";
import {
  CORES_CONDICAO,
  aoFaltarImagem,
  iconeGrupo,
  pinturaArvores,
  registrarIcones,
} from "../../mapa/simbologia";
import { urlApi } from "../../mapa/url";

/** Mapa do território na visão geral: árvores pela condição aparente. */
export function MapaResumo() {
  const camadas = useMapaCamadas();
  const mapa = useRef<MapaMapLibre | null>(null);
  const [pronto, setPronto] = useState(false);
  const limites = camadas.data?.data.limites_escopo;

  const aoCarregar = (m: MapaMapLibre) => {
    mapa.current = m;
    registrarIcones(m);
    m.on("styleimagemissing", (e) => aoFaltarImagem(m, e.id));
    m.addSource("bairros", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({
      id: "bairros",
      type: "line",
      source: "bairros",
      paint: { "line-color": "#2b5f45", "line-width": 1.2, "line-opacity": 0.7 },
    });
    m.addSource("arvores", {
      type: "vector",
      tiles: [urlApi("/api/v1/mapa/tiles/arvores/{z}/{x}/{y}")],
    });
    m.addLayer({
      id: "arvores",
      type: "circle",
      source: "arvores",
      "source-layer": "arvores",
      filter: ["==", ["get", "quantidade"], 1],
      paint: pinturaArvores("condicao") as never,
    });
    m.addLayer({
      id: "grupos",
      type: "symbol",
      source: "arvores",
      "source-layer": "arvores",
      filter: [">", ["get", "quantidade"], 1],
      layout: { "icon-image": iconeGrupo("arvores"), "icon-allow-overlap": true },
    });
    setPronto(true);
  };

  useEffect(() => {
    if (!pronto) return;
    void territoriosGeojson({ tipo: "bairro", precisao: 5 }).then(({ data }) =>
      (mapa.current?.getSource("bairros") as GeoJSONSource | undefined)?.setData(
        data as Parameters<GeoJSONSource["setData"]>[0],
      ),
    );
  }, [pronto]);

  useEffect(() => {
    if (!pronto || !limites) return;
    const m = mapa.current;
    if (!m) return;
    m.fitBounds(limites as [number, number, number, number], { padding: 24, duration: 0 });
    // O município inteiro quase não mostra árvores: depois de carregar os tiles, reenquadra pela
    // extensão do que há de dado (R3-16).
    m.once("idle", () => {
      const pontos = m
        .queryRenderedFeatures({ layers: ["arvores", "grupos"] })
        .flatMap((f) =>
          f.geometry.type === "Point" ? [f.geometry.coordinates as [number, number]] : [],
        );
      const caixa = limitesDosPontos(pontos);
      if (caixa) m.fitBounds(caixa, { padding: 40, maxZoom: 15, duration: 0 });
    });
  }, [pronto, limites]);

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-borda bg-superficie">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <h2 className="font-semibold">Árvores no território</h2>
          <p className="text-xs text-texto-suave">Cor pela condição aparente validada</p>
        </div>
        <Link
          to="/mapa"
          className="inline-flex items-center gap-1 text-sm text-marca-escura hover:underline"
        >
          <Maximize2 className="size-3.5" aria-hidden /> Abrir mapa
        </Link>
      </div>
      <Mapa
        base="ruas"
        rotulo="Mapa resumido das árvores do seu escopo"
        // Altura própria: o contêiner interno do mapa usa `h-full`, que vira 0 quando o
        // pai só tem `min-height` (o mapa aparecia em branco).
        className="h-80 shrink-0"
        aoCarregar={aoCarregar}
      />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 text-xs text-texto-suave">
        {(Object.keys(CORES_CONDICAO) as (keyof typeof CORES_CONDICAO)[]).map((c) => (
          <li key={c} className="flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-full ring-1 ring-black/10"
              style={{ background: CORES_CONDICAO[c] }}
            />
            {ROTULOS_CONDICAO[c]}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-3.5 shrink-0 rounded-full border-[3px] bg-white"
            style={{ borderColor: CORES_CONDICAO.ruim }}
          />
          Grupo: o anel mostra a pior condição
        </li>
      </ul>
    </section>
  );
}
