import type { Map as MapaMapLibre } from "maplibre-gl";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { Mapa } from "./Mapa";
import type { TipoBase } from "./estilo";

interface Props {
  base: TipoBase;
  /** Mapa principal, que mostra a data escolhida e comanda a câmera. */
  mapaPrincipal: MapaMapLibre | null;
  /** Monta as camadas do presente no mapa do lado direito. */
  aoCarregarHoje: (mapa: MapaMapLibre) => void;
  /** Data escolhida, como aparece no chip do lado esquerdo ("Situação em mar/2026"). */
  rotuloAntes: string;
}

/**
 * Cortina "antes e depois": por cima do mapa principal (a data escolhida), um segundo mapa com o
 * presente, recortado à direita da alça. O segundo mapa só acompanha a câmera do principal e não
 * recebe toque nem clique; quem arrasta a alça escolhe quanto de cada lado aparece.
 */
export function CortinaComparacao({ base, mapaPrincipal, aoCarregarHoje, rotuloAntes }: Props) {
  const [posicao, setPosicao] = useState(50);
  const [mapaHoje, setMapaHoje] = useState<MapaMapLibre | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const arrastando = useRef(false);

  // O mapa de hoje repete a câmera do principal, a cada movimento.
  useEffect(() => {
    if (!mapaPrincipal || !mapaHoje) return;
    const acompanhar = () =>
      mapaHoje.jumpTo({
        center: mapaPrincipal.getCenter(),
        zoom: mapaPrincipal.getZoom(),
        bearing: mapaPrincipal.getBearing(),
        pitch: mapaPrincipal.getPitch(),
      });
    acompanhar();
    mapaPrincipal.on("move", acompanhar);
    return () => void mapaPrincipal.off("move", acompanhar);
  }, [mapaPrincipal, mapaHoje]);

  const mover = (e: PointerEvent<HTMLElement>) => {
    const caixa = area.current?.getBoundingClientRect();
    if (!arrastando.current || !caixa?.width) return;
    setPosicao(Math.min(100, Math.max(0, ((e.clientX - caixa.left) / caixa.width) * 100)));
  };
  const teclar = (e: KeyboardEvent<HTMLElement>) => {
    const passo = e.shiftKey ? 20 : 5;
    if (e.key === "ArrowLeft") setPosicao((p) => Math.max(0, p - passo));
    else if (e.key === "ArrowRight") setPosicao((p) => Math.min(100, p + passo));
    else if (e.key === "Home") setPosicao(0);
    else if (e.key === "End") setPosicao(100);
    else return;
    e.preventDefault();
  };

  // Câmera de partida do mapa de hoje: a do principal no instante em que a cortina abre.
  const [centroInicial] = useState<[number, number] | undefined>(() => {
    const c = mapaPrincipal?.getCenter();
    return c ? [c.lng, c.lat] : undefined;
  });
  const [zoomInicial] = useState(() => mapaPrincipal?.getZoom());

  return (
    <div ref={area} className="pointer-events-none absolute inset-0 z-[5]">
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${posicao}%)` }}>
        <Mapa
          base={base}
          somenteLeitura
          className="h-full w-full"
          rotulo="Mapa de hoje, para comparação"
          centro={centroInicial}
          zoom={zoomInicial}
          aoCarregar={(m) => {
            aoCarregarHoje(m);
            setMapaHoje(m);
          }}
        />
      </div>
      <div className="absolute inset-y-0" style={{ left: `${posicao}%` }}>
        <div className="absolute inset-y-0 -left-px w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />
        <span className="absolute top-[calc(50%-3.25rem)] right-full mr-3 rounded-md bg-superficie/95 px-2 py-1 text-xs font-semibold whitespace-nowrap shadow">
          {rotuloAntes}
        </span>
        <span className="absolute top-[calc(50%-3.25rem)] left-full ml-3 rounded-md bg-superficie/95 px-2 py-1 text-xs font-semibold whitespace-nowrap shadow">
          Hoje
        </span>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Posição da cortina: a data escolhida à esquerda, hoje à direita"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(posicao)}
          aria-valuetext={`${Math.round(posicao)}% do mapa mostra a data escolhida`}
          className="pointer-events-auto absolute top-1/2 left-0 flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-full border-2 border-white bg-marca text-white shadow-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-info"
          onPointerDown={(e) => {
            arrastando.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={mover}
          onPointerUp={() => void (arrastando.current = false)}
          onPointerCancel={() => void (arrastando.current = false)}
          onKeyDown={teclar}
        >
          <span aria-hidden className="text-sm leading-none">
            ◂▸
          </span>
        </div>
      </div>
    </div>
  );
}
