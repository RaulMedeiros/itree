import { useEffect } from "react";

import { MapaFalso, mapasCriados } from "./mapaFalso";

export function MapaFalsoComponente({
  aoCarregar,
  rotulo,
  centro,
  zoom,
  somenteLeitura,
  base,
  children,
}: {
  aoCarregar?: (m: never) => void;
  rotulo?: string;
  centro?: [number, number];
  zoom?: number;
  somenteLeitura?: boolean;
  base?: string;
  children?: React.ReactNode;
}) {
  useEffect(() => {
    const m = new MapaFalso();
    m.opcoes = { centro, zoom, somenteLeitura };
    mapasCriados.push(m);
    aoCarregar?.(m as never);
    // Carrega uma vez, como o mapa real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div role="region" aria-label={rotulo} data-base={base}>
      {children}
    </div>
  );
}
