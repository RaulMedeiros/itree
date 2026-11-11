import type { ReactNode } from "react";

import { useUsuario } from "../acesso/ContextoUsuario";

/**
 * Códigos internos (DP-xx, RN-xx, RF-xx) não são para o usuário final (R2-14): só
 * administradores os veem, recolhidos em "Detalhes técnicos".
 */
export function DetalhesTecnicos({ children }: { children: ReactNode }) {
  const eu = useUsuario();
  if (!eu.papeis.includes("administrador")) return null;
  return (
    <details className="mt-2 text-xs text-texto-suave">
      <summary className="cursor-pointer">Detalhes técnicos</summary>
      <p className="mt-1">{children}</p>
    </details>
  );
}
