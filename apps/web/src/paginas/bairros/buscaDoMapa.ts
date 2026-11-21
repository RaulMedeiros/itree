import type { FichaBairro } from "@itree/api-client";

/** Parâmetros da URL do mapa enquadrado no bairro (o mesmo que a busca global usa). */
export function buscaDoMapa(bairro: FichaBairro, extras: Record<string, string> = {}) {
  const [oeste, sul, leste, norte] = bairro.limites as [number, number, number, number];
  return {
    lon: Number(((oeste + leste) / 2).toFixed(5)),
    lat: Number(((sul + norte) / 2).toFixed(5)),
    zoom: 14,
    destaque: bairro.id,
    ...extras,
  };
}
