import { useEffect, type ReactNode } from "react";
import { hasAuthParams, useAuth } from "react-oidc-context";

import { Botao } from "../ui/botao";
import { TelaCheia } from "./TelaCheia";

/** Garante sessão autenticada antes de renderizar a aplicação. */
export function ExigirLogin({ children }: { children: ReactNode }) {
  const auth = useAuth();

  useEffect(() => {
    if (
      !hasAuthParams() &&
      !auth.isAuthenticated &&
      !auth.activeNavigator &&
      !auth.isLoading &&
      !auth.error
    ) {
      void auth.signinRedirect({ state: window.location.pathname + window.location.search });
    }
  }, [auth]);

  if (auth.error) {
    return (
      <TelaCheia titulo="Não foi possível entrar">
        <p>O provedor de identidade não respondeu como esperado ({auth.error.message}).</p>
        <Botao className="mt-4" onClick={() => void auth.signinRedirect()}>
          Tentar novamente
        </Botao>
      </TelaCheia>
    );
  }
  if (!auth.isAuthenticated) {
    return <TelaCheia titulo="Entrando…" carregando />;
  }
  return children;
}
