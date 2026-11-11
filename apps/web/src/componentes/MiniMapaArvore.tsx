import type { Arvore } from "@itree/api-client";
import { ROTULOS_CONDICAO } from "@itree/domain";
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";
import { useEffect, useRef } from "react";

import { Mapa } from "../mapa/Mapa";
import { CORES_CONDICAO, pinturaArvores } from "../mapa/simbologia";
import { SeloLocalizacao } from "./selos";

type ArvoreNoMapa = Pick<
  Arvore,
  "id" | "codigo" | "localizacao" | "localizacao_origem" | "precisao_m" | "condicao_aparente"
>;

const ZOOM = 17;

/** Ponto único com as mesmas propriedades que o mapa principal usa para pintar a árvore. */
function pontoDaArvore(a: ArvoreNoMapa) {
  return {
    type: "FeatureCollection" as const,
    features: a.localizacao
      ? [
          {
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: [a.localizacao.longitude, a.localizacao.latitude],
            },
            properties: {
              id: a.id,
              condicao: a.condicao_aparente || "nao_avaliada",
              localizacao_origem: a.localizacao_origem ?? "",
            },
          },
        ]
      : [],
  };
}

/**
 * Mini-mapa somente leitura da ficha: o marcador tem a cor da condição aparente e o contorno
 * da origem da localização, como no mapa principal. A condição e a origem também aparecem
 * em texto, porque a cor sozinha não basta (RNF-A11Y-002).
 */
export function MiniMapaArvore({ arvore }: { arvore: ArvoreNoMapa }) {
  const mapa = useRef<MapaMapLibre | null>(null);
  const localizacao = arvore.localizacao;

  const aoCarregar = (m: MapaMapLibre) => {
    mapa.current = m;
    m.addSource("arvore", { type: "geojson", data: pontoDaArvore(arvore) });
    m.addLayer({
      id: "arvore",
      type: "circle",
      source: "arvore",
      // Maior que no mapa geral: aqui é a única árvore na tela.
      paint: { ...pinturaArvores("condicao"), "circle-radius": 9 } as never,
    });
  };

  // Edição da localização ou nova inspeção validada: o marcador acompanha o cadastro.
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    (m.getSource("arvore") as GeoJSONSource | undefined)?.setData(pontoDaArvore(arvore));
    if (arvore.localizacao)
      m.jumpTo({ center: [arvore.localizacao.longitude, arvore.localizacao.latitude] });
  }, [arvore]);

  if (!localizacao) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-borda bg-fundo p-4 text-center text-sm text-texto-suave">
        Sem localização cadastrada para mostrar no mapa.
      </div>
    );
  }

  const condicao = (arvore.condicao_aparente || "nao_avaliada") as keyof typeof CORES_CONDICAO;
  return (
    <div className="relative overflow-hidden rounded-lg border border-borda">
      <Mapa
        base="ruas"
        rotulo={`Localização de ${arvore.codigo} no mapa (somente leitura)`}
        className="h-56"
        centro={[localizacao.longitude, localizacao.latitude]}
        zoom={ZOOM}
        somenteLeitura
        aoCarregar={aoCarregar}
      />
      <ul className="absolute bottom-2 left-2 flex flex-wrap items-center gap-1.5 text-xs">
        <li className="inline-flex items-center gap-1.5 rounded-full bg-superficie/95 px-2 py-0.5 shadow-sm">
          <span
            aria-hidden
            className="size-2.5 rounded-full ring-1 ring-black/10"
            style={{ backgroundColor: CORES_CONDICAO[condicao] }}
          />
          {ROTULOS_CONDICAO[condicao]}
        </li>
        <li className="rounded-full bg-superficie/95 shadow-sm">
          <SeloLocalizacao origem={arvore.localizacao_origem ?? ""} precisao={arvore.precisao_m} />
        </li>
      </ul>
    </div>
  );
}
