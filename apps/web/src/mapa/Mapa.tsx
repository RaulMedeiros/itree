import "maplibre-gl/dist/maplibre-gl.css";

import { maplibregl } from "./maplibre";
import type { Map as MapaMapLibre } from "maplibre-gl";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { gerenciadorUsuario } from "../autenticacao/gerenciador";
import { config } from "../config";
import { cn } from "../util/cn";
import { CENTRO_PADRAO, estiloBase, type TipoBase } from "./estilo";
import { urlApi } from "./url";

let tokenAtual: string | undefined;
void gerenciadorUsuario.getUser?.().then((u) => {
  tokenAtual = u?.access_token;
});
gerenciadorUsuario.events?.addUserLoaded((u) => {
  tokenAtual = u.access_token;
});

interface Props {
  base: TipoBase;
  className?: string;
  centro?: [number, number];
  zoom?: number;
  aoCarregar?: (mapa: MapaMapLibre) => void;
  children?: ReactNode;
  rotulo: string;
}

/**
 * Mapa MapLibre com o token OIDC nas requisições à API (vector tiles com
 * escopo territorial) e troca de mapa base sem perder camadas.
 */
export function Mapa({ base, className, centro, zoom, aoCarregar, children, rotulo }: Props) {
  const elemento = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaMapLibre | null>(null);
  const [pronto, setPronto] = useState(false);
  const camadaBase = base === "ruas" ? config.mapaRuas : config.mapaSatelite;

  useEffect(() => {
    if (!elemento.current) return;
    const origemApi = urlApi("/api/");
    const instancia = new maplibregl.Map({
      container: elemento.current,
      style: estiloBase(camadaBase ?? null),
      center: centro ?? CENTRO_PADRAO,
      zoom: zoom ?? 11,
      attributionControl: { compact: true },
      transformRequest: (url) =>
        url.startsWith(origemApi) && tokenAtual
          ? {
              url,
              headers: { Authorization: `Bearer ${tokenAtual}`, "X-Itree-Origem": "web" },
            }
          : { url },
    });
    instancia.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    instancia.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    instancia.on("load", () => {
      setPronto(true);
      aoCarregar?.(instancia);
    });
    mapa.current = instancia;
    return () => {
      instancia.remove();
      mapa.current = null;
    };
    // O mapa é criado uma vez; base e camadas mudam por efeitos próprios.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Troca do mapa base preservando as camadas de dados.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !pronto) return;
    if (m.getLayer("base")) m.removeLayer("base");
    if (m.getSource("base")) m.removeSource("base");
    if (camadaBase) {
      m.addSource("base", {
        type: "raster",
        tiles: [camadaBase.url],
        tileSize: camadaBase.tamanho ?? 256,
        attribution: camadaBase.atribuicao,
        maxzoom: 19,
      });
      const primeira = m.getStyle().layers.find((l) => l.id !== "fundo")?.id;
      m.addLayer({ id: "base", type: "raster", source: "base" }, primeira);
    }
  }, [camadaBase, pronto]);

  return (
    // O MapLibre redefine atributos de acessibilidade do contêiner interno;
    // o rótulo fica no elemento externo.
    <div className={cn("relative", className)} role="region" aria-label={rotulo}>
      <div ref={elemento} className="h-full w-full" />
      {children}
    </div>
  );
}
