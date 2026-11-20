import { areasVerdesListar, type FichaBairro } from "@itree/api-client";
import { ROTULOS_CONDICAO } from "@itree/domain";
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";
import { useRef } from "react";

import { usePermissao } from "../../acesso/ContextoUsuario";
import { Mapa } from "../../mapa/Mapa";
import {
  COR_AREA_VERDE_POR_TIPO,
  CORES_AREA_VERDE,
  CORES_CONDICAO,
  HACHURA_AREA_VERDE,
  ID_OCORRENCIA,
  OPACIDADE_AREA_VERDE,
  OPACIDADE_AREA_VERDE_UC,
  OPACIDADE_HACHURA_AREA_VERDE,
  aoFaltarImagem,
  filtroArvoreIndividual,
  filtroGrupoDeArvores,
  layoutGrupo,
  pinturaArvores,
  registrarIcones,
} from "../../mapa/simbologia";
import { adicionarRealce, definirRealce, type FeicaoTerritorio } from "../../mapa/realce";
import { urlApi } from "../../mapa/url";

type Caixa = [number, number, number, number];

function urlTiles(camada: "arvores" | "ocorrencias", bairro: string) {
  return urlApi(`/api/v1/mapa/tiles/${camada}/{z}/{x}/{y}?bairro=${bairro}`);
}

/**
 * Mapa do bairro na ficha: polígono em destaque (o resto do mapa esmaecido), árvores pela
 * condição aparente, ocorrências abertas e áreas verdes e praças. Usa as mesmas camadas e
 * símbolos do mapa principal, só com o filtro do bairro nos tiles.
 */
export function MapaDoBairro({ bairro }: { bairro: FichaBairro }) {
  const podeMapa = usePermissao("mapa.ler");
  const podeOcorrencias = usePermissao("ocorrencias.ler");
  const mapa = useRef<MapaMapLibre | null>(null);

  const aoCarregar = (m: MapaMapLibre) => {
    mapa.current = m;
    registrarIcones(m);
    m.on("styleimagemissing", (e) => aoFaltarImagem(m, e.id));

    m.addSource("areas-verdes", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    m.addLayer({
      id: "areas-verdes-preenchimento",
      type: "fill",
      source: "areas-verdes",
      paint: {
        "fill-color": COR_AREA_VERDE_POR_TIPO as never,
        "fill-opacity": [
          "match",
          ["get", "tipo"],
          "unidade_conservacao",
          OPACIDADE_AREA_VERDE_UC,
          OPACIDADE_AREA_VERDE,
        ],
      },
    });
    m.addLayer({
      id: "areas-verdes-hachura",
      type: "fill",
      source: "areas-verdes",
      paint: {
        "fill-pattern": HACHURA_AREA_VERDE as never,
        "fill-opacity": OPACIDADE_HACHURA_AREA_VERDE,
      },
    });
    m.addLayer({
      id: "areas-verdes-contorno",
      type: "line",
      source: "areas-verdes",
      paint: {
        "line-color": COR_AREA_VERDE_POR_TIPO as never,
        "line-width": 1.5,
        "line-opacity": 0.9,
      },
    });

    if (podeMapa) {
      m.addSource("arvores", {
        type: "vector",
        tiles: [urlTiles("arvores", bairro.id)],
        minzoom: 0,
        maxzoom: 22,
      });
      m.addLayer({
        id: "arvores-pontos",
        type: "circle",
        source: "arvores",
        "source-layer": "arvores",
        filter: filtroArvoreIndividual,
        paint: pinturaArvores("condicao") as never,
      });
      m.addLayer({
        id: "arvores-grupos",
        type: "symbol",
        source: "arvores",
        "source-layer": "arvores",
        filter: filtroGrupoDeArvores,
        layout: layoutGrupo("arvores") as never,
      });
    }
    if (podeOcorrencias) {
      m.addSource("ocorrencias", {
        type: "vector",
        tiles: [urlTiles("ocorrencias", bairro.id)],
        minzoom: 0,
        maxzoom: 22,
      });
      m.addLayer({
        id: "ocorrencias-grupos",
        type: "symbol",
        source: "ocorrencias",
        "source-layer": "ocorrencias",
        filter: [">", ["get", "quantidade"], 1],
        layout: layoutGrupo("ocorrencias") as never,
      });
      m.addLayer({
        id: "ocorrencias-pontos",
        type: "symbol",
        source: "ocorrencias",
        "source-layer": "ocorrencias",
        filter: ["==", ["get", "quantidade"], 1],
        layout: {
          "icon-image": ID_OCORRENCIA as never,
          "icon-allow-overlap": true,
          "icon-anchor": "bottom",
        },
      });
    }

    // Máscara clara fora do bairro, abaixo das árvores; contorno grosso por cima de tudo.
    adicionarRealce(m, undefined, podeMapa ? "arvores-pontos" : undefined);
    const feicao: FeicaoTerritorio = {
      type: "Feature",
      geometry: bairro.geometria as unknown as FeicaoTerritorio["geometry"],
      properties: { nome: bairro.nome },
    };
    definirRealce(m, feicao);

    const caixa = bairro.limites as Caixa;
    m.fitBounds(caixa, { padding: 28, duration: 0 });

    if (podeMapa) {
      const [o, s, l, n] = caixa;
      void areasVerdesListar({ bbox: `${o},${s},${l},${n}`, precisao: 5 }).then(({ data }) =>
        (m.getSource("areas-verdes") as GeoJSONSource | undefined)?.setData(
          data as unknown as Parameters<GeoJSONSource["setData"]>[0],
        ),
      );
    }
  };

  return (
    <section
      aria-label={`Mapa do bairro ${bairro.nome}`}
      className="evitar-quebra relative overflow-hidden rounded-xl border border-borda bg-superficie"
    >
      {podeMapa ? (
        <Mapa
          base="ruas"
          rotulo={`Mapa do bairro ${bairro.nome}: árvores, ocorrências e áreas verdes`}
          className="h-[400px]"
          aoCarregar={aoCarregar}
        />
      ) : (
        <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-texto-suave">
          O seu perfil não acessa o mapa. Os números da ficha continuam valendo.
        </div>
      )}
      {podeMapa && <LegendaCompacta ocorrencias={podeOcorrencias} />}
    </section>
  );
}

const CONDICOES = ["boa", "regular", "ruim", "morta", "nao_avaliada"] as const;

/** Legenda no pé do mapa: cor da condição, triângulo da ocorrência e as áreas verdes. */
function LegendaCompacta({ ocorrencias }: { ocorrencias: boolean }) {
  return (
    <ul
      aria-label="Legenda do mapa do bairro"
      className="flex flex-wrap gap-x-4 gap-y-1 border-t border-borda px-4 py-2.5 text-xs text-texto-suave"
    >
      {CONDICOES.map((c) => (
        <li key={c} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-full ring-1 ring-black/10"
            style={{ background: CORES_CONDICAO[c] }}
          />
          {ROTULOS_CONDICAO[c]}
        </li>
      ))}
      {ocorrencias && (
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-texto-suave"
          />
          Ocorrência aberta
        </li>
      )}
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block size-3 rounded-sm border"
          style={{ borderColor: CORES_AREA_VERDE.praca, background: `${CORES_AREA_VERDE.praca}40` }}
        />
        Praça, parque ou unidade de conservação
      </li>
    </ul>
  );
}
