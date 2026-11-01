import { useEffect } from "react";

const SISTEMA = "Engine de Inteligência Arbórea";

/** Título da aba por tela (WCAG 2.4.2); volta ao nome do sistema ao sair. */
export function useTituloDocumento(titulo: string) {
  useEffect(() => {
    document.title = titulo ? `${titulo} · ${SISTEMA}` : SISTEMA;
    return () => {
      document.title = SISTEMA;
    };
  }, [titulo]);
}
