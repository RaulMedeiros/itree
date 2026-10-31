import { useEu, type Eu, type PermissaoEnum } from "@itree/api-client";
import { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "react-oidc-context";

import { TelaCheia } from "../autenticacao/TelaCheia";
import { Botao } from "../ui/botao";
import { Erro } from "../ui/estados";

const Contexto = createContext<Eu | null>(null);

/** Carrega o usuário autenticado (papéis, permissões e escopo) da API. */
export function ProvedorUsuario({ children }: { children: ReactNode }) {
  const consulta = useEu({ query: { staleTime: 60_000, retry: 1 } });
  const auth = useAuth();

  if (consulta.isPending) return <TelaCheia titulo="Carregando seu perfil…" carregando />;
  if (consulta.isError) {
    return (
      <main className="mx-auto max-w-lg p-10">
        <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      </main>
    );
  }

  const eu = consulta.data.data;
  if (eu.permissoes.length === 0) {
    return (
      <TelaCheia titulo="Seu acesso aguarda liberação">
        <p>
          Você entrou como <strong>{eu.email}</strong>, mas ainda não tem papéis atribuídos. Um
          administrador precisa liberar seu acesso.
        </p>
        <Botao variante="secundario" className="mt-4" onClick={() => void auth.signoutRedirect()}>
          Sair
        </Botao>
      </TelaCheia>
    );
  }
  return <Contexto.Provider value={eu}>{children}</Contexto.Provider>;
}

export function useUsuario(): Eu {
  const eu = useContext(Contexto);
  if (!eu) throw new Error("useUsuario fora de ProvedorUsuario");
  return eu;
}

export function usePermissao(...permissoes: PermissaoEnum[]): boolean {
  const eu = useUsuario();
  return permissoes.every((p) => eu.permissoes.includes(p));
}

/** Renderiza o conteúdo só se o usuário tiver as permissões; caso contrário, nada. */
export function SeTiver({
  permissoes,
  children,
}: {
  permissoes: PermissaoEnum[];
  children: ReactNode;
}) {
  return usePermissao(...permissoes) ? children : null;
}
