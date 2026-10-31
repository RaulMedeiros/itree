import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "react-oidc-context";

import { ErroApi } from "@itree/api-client";

import { gerenciadorUsuario } from "./autenticacao/gerenciador";
import { roteador } from "./rotas";
import "./estilos.css";

const clienteConsultas = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Não repetir erros de permissão/validação; repetir falhas de rede/servidor.
      retry: (tentativas, erro) =>
        !(erro instanceof ErroApi && erro.status >= 400 && erro.status < 500) && tentativas < 2,
    },
  },
});

/** Volta para a página em que o usuário estava antes do login. */
function aoConcluirLogin(usuario: { state?: unknown } | void) {
  const destino = typeof usuario?.state === "string" ? usuario.state : "/";
  window.history.replaceState({}, document.title, destino);
  void roteador.navigate({ to: destino, replace: true });
}

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <AuthProvider userManager={gerenciadorUsuario} onSigninCallback={aoConcluirLogin}>
      <QueryClientProvider client={clienteConsultas}>
        <RouterProvider router={roteador} />
      </QueryClientProvider>
    </AuthProvider>
  </StrictMode>,
);
