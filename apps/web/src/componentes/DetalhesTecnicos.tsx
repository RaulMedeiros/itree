import type { ReactNode } from "react";

import { useUsuario } from "../acesso/ContextoUsuario";
import { Recolhivel } from "../ui/recolhivel";

/**
 * Códigos internos (DP-xx, RN-xx, RF-xx) não são para o usuário final (R2-14): só
 * administradores os veem, recolhidos em "Detalhes técnicos".
 */
export function DetalhesTecnicos({ children }: { children: ReactNode }) {
  const eu = useUsuario();
  if (!eu.papeis.includes("administrador")) return null;
  return (
    <Recolhivel titulo="Detalhes técnicos" className="text-xs text-texto-suave">
      <p>{children}</p>
    </Recolhivel>
  );
}
