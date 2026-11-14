/**
 * Plataforma do dispositivo de campo, em texto humano (R3-25). O identificador que o aplicativo
 * grava ("android-sintetico", "android-1") não é para a tela: só a plataforma interessa.
 * Devolve null quando não reconhece, e a tela omite o trecho em vez de mostrar o identificador cru.
 */
export function plataformaDoDispositivo(dispositivo: string | null | undefined): string | null {
  const d = (dispositivo ?? "").trim().toLowerCase();
  if (d.startsWith("android")) return "Android";
  if (/^(ios|iphone|ipad)/.test(d)) return "iOS";
  return null;
}
