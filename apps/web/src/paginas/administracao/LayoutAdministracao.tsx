import { Link, Outlet } from "@tanstack/react-router";

import { useUsuario } from "../../acesso/ContextoUsuario";
import { SECOES_ADMIN } from "../../acesso/modulos";

export function LayoutAdministracao() {
  const eu = useUsuario();
  const secoes = SECOES_ADMIN.filter((s) => eu.permissoes.includes(s.permissao));
  return (
    <div className="mx-auto max-w-6xl">
      <nav aria-label="Seções da administração" className="mb-5 flex gap-1 border-b border-borda">
        {secoes.map((s) => (
          <Link
            key={s.id}
            to={s.caminho}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-texto-suave hover:text-texto"
            activeProps={{ className: "border-marca! font-medium text-texto!" }}
          >
            {s.rotulo}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
