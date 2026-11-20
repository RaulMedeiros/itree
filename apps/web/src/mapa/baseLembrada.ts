import type { TipoBase } from "./estilo";

const chave = (usuarioId: string) => `itree:mapa-base:${usuarioId}`;

/** Base de mapa que a pessoa escolheu da última vez; sem armazenamento local, `null`. */
export function lerBaseLembrada(usuarioId: string): TipoBase | null {
  try {
    const valor = localStorage.getItem(chave(usuarioId));
    return valor === "ruas" || valor === "satelite" ? valor : null;
  } catch {
    return null;
  }
}

export function lembrarBase(usuarioId: string, base: TipoBase): void {
  try {
    localStorage.setItem(chave(usuarioId), base);
  } catch {
    // Janela privada ou armazenamento bloqueado: a escolha vale só pela URL.
  }
}

/**
 * Base efetiva: a URL vale mais (o link compartilhado mostra o que quem o enviou viu), depois a
 * lembrada. "Satélite" só existe com o provedor configurado; sem ele, sempre ruas.
 */
export function baseEfetiva(
  daUrl: TipoBase | undefined,
  lembrada: TipoBase | null,
  temSatelite: boolean,
): TipoBase {
  const pedida = daUrl ?? lembrada ?? "ruas";
  return pedida === "satelite" && !temSatelite ? "ruas" : pedida;
}
