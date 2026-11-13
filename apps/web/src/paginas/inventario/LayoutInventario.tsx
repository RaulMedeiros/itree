import { Outlet } from "@tanstack/react-router";

import { useUsuario } from "../../acesso/ContextoUsuario";
import { AbasSecao } from "../../ui/pagina";

const SECOES = [
  { para: "/inventario/arvores", rotulo: "Árvores", permissao: "inventario.ler" },
  { para: "/inventario/especies", rotulo: "Espécies", permissao: "inventario.ler" },
  { para: "/inventario/importacoes", rotulo: "Importações", permissao: "inventario.importar" },
  {
    para: "/inventario/duplicidades",
    rotulo: "Possíveis duplicidades",
    permissao: "inventario.ler",
  },
  { para: "/inventario/qualidade", rotulo: "Qualidade de dados", permissao: "inventario.ler" },
] as const;

export function LayoutInventario() {
  const eu = useUsuario();
  return (
    <div className="mx-auto max-w-7xl">
      <AbasSecao
        rotulo="Seções do inventário"
        abas={SECOES.filter((s) => eu.permissoes.includes(s.permissao))}
      />
      <Outlet />
    </div>
  );
}
