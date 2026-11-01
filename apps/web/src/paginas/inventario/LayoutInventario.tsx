import { Link, Outlet } from "@tanstack/react-router";

import { useUsuario } from "../../acesso/ContextoUsuario";

const SECOES = [
  { caminho: "/inventario/arvores", rotulo: "Árvores", permissao: "inventario.ler" },
  { caminho: "/inventario/importacoes", rotulo: "Importações", permissao: "inventario.importar" },
  {
    caminho: "/inventario/duplicidades",
    rotulo: "Possíveis duplicidades",
    permissao: "inventario.ler",
  },
] as const;

export function LayoutInventario() {
  const eu = useUsuario();
  return (
    <div className="mx-auto max-w-7xl">
      <nav aria-label="Seções do inventário" className="mb-5 flex gap-1 border-b border-borda">
        {SECOES.filter((s) => eu.permissoes.includes(s.permissao)).map((s) => (
          <Link
            key={s.caminho}
            to={s.caminho}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-texto-suave hover:text-texto"
            activeProps={{ className: "border-marca! font-medium text-texto!" }}
            activeOptions={{ exact: false }}
          >
            {s.rotulo}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
