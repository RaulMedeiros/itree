import { maplibregl } from "../mapa/maplibre";
import type { Map as MapaMapLibre, Marker } from "maplibre-gl";
import { useEffect, useRef } from "react";

import { Mapa } from "../mapa/Mapa";
import { COR_ARVORE } from "../mapa/simbologia";
import { Campo, Entrada } from "../ui/campos";

export interface Ponto {
  longitude: number;
  latitude: number;
}

/** Clique no mapa ou digite as coordenadas (WGS 84). */
export function SeletorLocalizacao({
  valor,
  aoMudar,
  erros,
}: {
  valor: Ponto | null;
  aoMudar: (p: Ponto | null) => void;
  erros?: string[];
}) {
  const mapa = useRef<MapaMapLibre | null>(null);
  const marcador = useRef<Marker | null>(null);

  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    if (!valor) {
      marcador.current?.remove();
      marcador.current = null;
      return;
    }
    if (!marcador.current) {
      marcador.current = new maplibregl.Marker({ color: COR_ARVORE })
        .setLngLat([valor.longitude, valor.latitude])
        .addTo(m);
    } else {
      marcador.current.setLngLat([valor.longitude, valor.latitude]);
    }
  }, [valor]);

  const numero = (texto: string) => {
    const n = Number(texto.replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  };

  return (
    <div className="flex flex-col gap-2">
      <Mapa
        base="ruas"
        rotulo="Mapa para escolher a localização"
        className="h-56 overflow-hidden rounded-md border border-borda"
        centro={valor ? [valor.longitude, valor.latitude] : undefined}
        zoom={valor ? 17 : 12}
        aoCarregar={(m) => {
          mapa.current = m;
          m.getCanvas().style.cursor = "crosshair";
          m.on("click", (e) =>
            aoMudar({ longitude: +e.lngLat.lng.toFixed(7), latitude: +e.lngLat.lat.toFixed(7) }),
          );
          if (valor)
            marcador.current = new maplibregl.Marker({ color: COR_ARVORE })
              .setLngLat([valor.longitude, valor.latitude])
              .addTo(m);
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Latitude" erros={erros}>
          {(p) => (
            <Entrada
              {...p}
              inputMode="decimal"
              value={valor?.latitude ?? ""}
              onChange={(e) => {
                const lat = numero(e.target.value);
                aoMudar(
                  Number.isNaN(lat)
                    ? null
                    : { longitude: valor?.longitude ?? -38.5267, latitude: lat },
                );
              }}
            />
          )}
        </Campo>
        <Campo rotulo="Longitude">
          {(p) => (
            <Entrada
              {...p}
              inputMode="decimal"
              value={valor?.longitude ?? ""}
              onChange={(e) => {
                const lon = numero(e.target.value);
                aoMudar(
                  Number.isNaN(lon)
                    ? null
                    : { latitude: valor?.latitude ?? -3.7319, longitude: lon },
                );
              }}
            />
          )}
        </Campo>
      </div>
      <p className="text-xs text-texto-suave">
        Localização definida no painel é registrada como <strong>estimada (web)</strong>, não como
        coleta de campo.
      </p>
    </div>
  );
}
