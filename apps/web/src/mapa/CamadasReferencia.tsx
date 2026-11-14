import {
  mapaCamadaReferencia,
  useMapaCamadasReferencia,
  type CamadaReferencia,
} from "@itree/api-client";
import type { GeoJSONSource, Map as MapaMapLibre, MapLayerMouseEvent } from "maplibre-gl";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import { usePermissao } from "../acesso/ContextoUsuario";
import { formatarData } from "../util/formatos";
import { idDaFonte, idsDasCamadas, linhasDoPopup } from "./camadasReferencia";
import { maplibregl } from "./maplibre";

type Estado = "carregando" | "pronto" | "erro";

const TIPOS_PONTO = ["Point", "MultiPoint"];
const TIPOS_LINHA = ["LineString", "MultiLineString"];
const TIPOS_AREA = ["Polygon", "MultiPolygon"];

function adicionarCamadas(m: MapaMapLibre, camada: CamadaReferencia, antesDe?: string) {
  const fonte = idDaFonte(camada.id);
  const [area, linha, ponto] = idsDasCamadas(camada.id) as [string, string, string];
  m.addSource(fonte, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const comum = { source: fonte, layout: { visibility: "visible" as const } };
  m.addLayer(
    {
      ...comum,
      id: area,
      type: "fill",
      filter: ["in", ["geometry-type"], ["literal", TIPOS_AREA]] as never,
      paint: { "fill-color": camada.cor, "fill-opacity": 0.22 },
    },
    antesDe,
  );
  m.addLayer(
    {
      ...comum,
      id: linha,
      type: "line",
      filter: ["in", ["geometry-type"], ["literal", [...TIPOS_LINHA, ...TIPOS_AREA]]] as never,
      paint: { "line-color": camada.cor, "line-width": 2 },
    },
    antesDe,
  );
  m.addLayer(
    {
      ...comum,
      id: ponto,
      type: "circle",
      filter: ["in", ["geometry-type"], ["literal", TIPOS_PONTO]] as never,
      paint: {
        "circle-color": camada.cor,
        "circle-radius": 5,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    },
    antesDe,
  );
}

/** Conteúdo do popup montado com nós de texto: nada que vem da fonte vira HTML. */
function montarPopup(camada: CamadaReferencia, propriedades: Record<string, unknown>): HTMLElement {
  const raiz = document.createElement("div");
  raiz.className = "max-w-72 text-sm";
  const titulo = document.createElement("p");
  titulo.className = "mb-1 font-semibold";
  titulo.textContent = camada.nome;
  raiz.append(titulo);
  const linhas = linhasDoPopup(propriedades, camada.rotulos);
  if (linhas.length === 0) {
    const vazio = document.createElement("p");
    vazio.textContent = "Sem informações cadastradas nesta feição.";
    raiz.append(vazio);
  }
  const lista = document.createElement("dl");
  for (const { rotulo, valor } of linhas) {
    const dt = document.createElement("dt");
    dt.className = "mt-1 text-xs text-gray-600";
    dt.textContent = rotulo;
    const dd = document.createElement("dd");
    dd.style.whiteSpace = "pre-wrap";
    dd.textContent = valor;
    lista.append(dt, dd);
  }
  raiz.append(lista);
  const fonte = document.createElement("p");
  fonte.className = "mt-2 text-xs text-gray-600";
  fonte.textContent = `Fonte: ${camada.orgao}`;
  raiz.append(fonte);
  return raiz;
}

/**
 * Camadas de referência dos conectores no painel de camadas (RF-INT-006): opcionais, desligadas
 * por padrão, cada uma com legenda, atribuição da fonte e popup com rótulos legíveis. A feição
 * só é buscada na primeira vez que a camada é ligada. São contexto, não inventário.
 */
export function CamadasReferencia({
  mapaRef,
  pronto,
  camadasPrioritarias = [],
}: {
  mapaRef: RefObject<MapaMapLibre | null>;
  pronto: boolean;
  /** Camadas com clique próprio (árvores, ocorrências): ficam por cima e ganham o clique. */
  camadasPrioritarias?: string[];
}) {
  const pode = usePermissao("mapa.ler");
  const consulta = useMapaCamadasReferencia({ query: { enabled: pode, staleTime: 5 * 60_000 } });
  const [ligadas, setLigadas] = useState<Set<string>>(new Set());
  const [estados, setEstados] = useState<Record<string, Estado>>({});
  const iniciadas = useRef(new Set<string>());
  const camadas = consulta.data?.data;

  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !pronto) return;
    for (const camada of camadas ?? []) {
      const visivel = ligadas.has(camada.id);
      if (visivel && !iniciadas.current.has(camada.id)) {
        iniciadas.current.add(camada.id);
        setEstados((e) => ({ ...e, [camada.id]: "carregando" }));
        const antesDe = camadasPrioritarias.find((id) => mapa.getLayer(id));
        adicionarCamadas(mapa, camada, antesDe);
        for (const id of idsDasCamadas(camada.id)) {
          mapa.on("mouseenter", id, () => (mapa.getCanvas().style.cursor = "pointer"));
          mapa.on("mouseleave", id, () => (mapa.getCanvas().style.cursor = ""));
          mapa.on("click", id, (e: MapLayerMouseEvent) => {
            const prioritarias = camadasPrioritarias.filter((p) => mapa.getLayer(p));
            if (
              prioritarias.length &&
              mapa.queryRenderedFeatures(e.point, { layers: prioritarias }).length
            )
              return;
            const propriedades = (e.features?.[0]?.properties ?? {}) as Record<string, unknown>;
            new maplibregl.Popup({ maxWidth: "320px" })
              .setLngLat(e.lngLat)
              .setDOMContent(montarPopup(camada, propriedades))
              .addTo(mapa);
          });
        }
        void mapaCamadaReferencia(camada.id, { precisao: 5 })
          .then(({ data }) => {
            (mapa.getSource(idDaFonte(camada.id)) as GeoJSONSource | undefined)?.setData(
              data as unknown as Parameters<GeoJSONSource["setData"]>[0],
            );
            setEstados((e) => ({ ...e, [camada.id]: "pronto" }));
          })
          .catch(() => setEstados((e) => ({ ...e, [camada.id]: "erro" })));
      } else if (iniciadas.current.has(camada.id)) {
        for (const id of idsDasCamadas(camada.id))
          mapa.setLayoutProperty(id, "visibility", visivel ? "visible" : "none");
      }
    }
    // As camadas prioritárias são fixas da tela; o efeito reage a ligar, desligar e à lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapaRef, pronto, ligadas, camadas]);

  if (!pode || !camadas || camadas.length === 0) return null;
  return (
    <details open className="group border-b border-borda py-2 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-xs font-semibold tracking-wide text-texto-suave uppercase">
        Camadas conectadas
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-1.5 flex flex-col gap-2">
        {camadas.map((c) => {
          const ligada = ligadas.has(c.id);
          return (
            <div key={c.id} className="flex flex-col gap-1">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-marca"
                  checked={ligada}
                  onChange={(e) =>
                    setLigadas((atual) => {
                      const novo = new Set(atual);
                      if (e.target.checked) novo.add(c.id);
                      else novo.delete(c.id);
                      return novo;
                    })
                  }
                />
                <span
                  aria-hidden
                  className="inline-block size-3 rounded-full border border-white shadow-sm"
                  style={{ background: c.cor }}
                />
                {c.nome}
                <span className="ml-auto text-xs text-texto-suave">{c.total}</span>
              </label>
              {ligada && (
                <div className="ml-6 text-xs text-texto-suave">
                  {estados[c.id] === "carregando" && <p>Carregando a camada…</p>}
                  {estados[c.id] === "erro" && (
                    <p role="alert" className="text-perigo">
                      Não foi possível carregar a camada.
                    </p>
                  )}
                  <p>
                    <span
                      aria-hidden
                      className="mr-1 inline-block size-2 rounded-full align-middle"
                      style={{ background: c.cor }}
                    />
                    Legenda: {c.nome} (contexto, não é inventário)
                  </p>
                  <p>
                    Fonte:{" "}
                    <a href={c.url_origem} target="_blank" rel="noreferrer" className="underline">
                      {c.orgao}
                    </a>
                    {" · "}
                    {c.licenca}
                    {c.atualizada_em && ` · atualizada em ${formatarData(c.atualizada_em)}`}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
