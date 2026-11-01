import { config } from "../config";

/** URL absoluta da API (tiles precisam de URL completa no MapLibre). */
export function urlApi(caminho: string): string {
  const base = config.urlApi || window.location.origin;
  return `${base.replace(/\/$/, "")}${caminho}`;
}
