import { useSyncExternalStore } from "react";

/** Abaixo de `md` do Tailwind (768 px): celular e tablet em pé estreito. */
export const CONSULTA_CELULAR = "(max-width: 767.98px)";

/**
 * Acompanha uma media query. Sem `matchMedia` (jsdom, impressão), vale `false`:
 * o desktop é o padrão e os testes existentes não mudam.
 */
export function useMediaQuery(consulta: string): boolean {
  return useSyncExternalStore(
    (aviso) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const lista = window.matchMedia(consulta);
      lista.addEventListener("change", aviso);
      return () => lista.removeEventListener("change", aviso);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(consulta).matches,
    () => false,
  );
}

/** Verdadeiro abaixo de `md`: onde menu, filtros, listas e painéis mudam de forma. */
export function useCelular(): boolean {
  return useMediaQuery(CONSULTA_CELULAR);
}
