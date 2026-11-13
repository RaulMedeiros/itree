import { Outlet } from "@tanstack/react-router";

import { useUsuario } from "../../acesso/ContextoUsuario";
import { SECOES_ADMIN } from "../../acesso/modulos";
import { AbasSecao } from "../../ui/pagina";

export function LayoutAdministracao() {
  const eu = useUsuario();
  const secoes = SECOES_ADMIN.filter((s) => eu.permissoes.includes(s.permissao));
  return (
    <div className="mx-auto max-w-6xl">
      <AbasSecao
        rotulo="Seções da administração"
        abas={secoes.map((s) => ({ para: s.caminho, rotulo: s.rotulo }))}
      />
      <Outlet />
    </div>
  );
}
