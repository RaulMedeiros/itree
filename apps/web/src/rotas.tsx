import type { PermissaoEnum } from "@itree/api-client";
import { PapelEnum } from "@itree/api-client";
import {
  Link,
  Navigate,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod";

import { ProvedorUsuario, usePermissao, useUsuario } from "./acesso/ContextoUsuario";
import { MODULOS, SECOES_ADMIN, modulosVisiveis, type Modulo } from "./acesso/modulos";
import { ExigirLogin } from "./autenticacao/ExigirLogin";
import { config } from "./config";
import { Shell } from "./layout/Shell";
import { EmConstrucao } from "./paginas/EmConstrucao";
import { AuditoriaPagina } from "./paginas/administracao/AuditoriaPagina";
import { EquipesPagina } from "./paginas/administracao/EquipesPagina";
import { LayoutAdministracao } from "./paginas/administracao/LayoutAdministracao";
import { TerritoriosPagina } from "./paginas/administracao/TerritoriosPagina";
import { UsuarioDetalhePagina } from "./paginas/administracao/UsuarioDetalhePagina";
import { UsuariosPagina } from "./paginas/administracao/UsuariosPagina";
import { SemPermissao } from "./ui/estados";

function Exige({ permissao, children }: { permissao: PermissaoEnum; children: ReactNode }) {
  return usePermissao(permissao) ? children : <SemPermissao />;
}

function NaoEncontrada() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold">Página não encontrada</h1>
      <p className="mt-1 text-sm text-texto-suave">O endereço pode ter mudado ou não existe.</p>
      <Link to="/" className="mt-4 inline-block text-sm text-marca-escura hover:underline">
        Ir para o início
      </Link>
    </div>
  );
}

/** "/" leva ao primeiro módulo entregue que o usuário pode ver. */
function Inicio() {
  const eu = useUsuario();
  const destino =
    modulosVisiveis(eu.permissoes, false)[0] ?? modulosVisiveis(eu.permissoes, true)[0];
  if (!destino) return <SemPermissao />;
  return <Navigate to={destino.caminho} replace />;
}

function InicioAdministracao() {
  const eu = useUsuario();
  const secao = SECOES_ADMIN.find((s) => eu.permissoes.includes(s.permissao));
  return secao ? <Navigate to={secao.caminho} replace /> : <SemPermissao />;
}

function ModuloFuturo({ modulo }: { modulo: Modulo }) {
  const eu = useUsuario();
  const visivel = modulosVisiveis(eu.permissoes, config.mostrarModulosFuturos).some(
    (m) => m.id === modulo.id,
  );
  if (!config.mostrarModulosFuturos) return <NaoEncontrada />;
  return visivel ? <EmConstrucao modulo={modulo} /> : <SemPermissao />;
}

const raiz = createRootRoute({ component: Outlet, notFoundComponent: NaoEncontrada });

const autenticado = createRoute({
  getParentRoute: () => raiz,
  id: "autenticado",
  component: () => (
    <ExigirLogin>
      <ProvedorUsuario>
        <Shell />
      </ProvedorUsuario>
    </ExigirLogin>
  ),
});

const inicio = createRoute({ getParentRoute: () => autenticado, path: "/", component: Inicio });

const administracao = createRoute({
  getParentRoute: () => autenticado,
  path: "administracao",
  component: LayoutAdministracao,
});

const administracaoInicio = createRoute({
  getParentRoute: () => administracao,
  path: "/",
  component: InicioAdministracao,
});

const paginaOpcional = z.coerce.number().int().positive().optional().catch(undefined);
const textoOpcional = z.string().optional().catch(undefined);

const usuarios = createRoute({
  getParentRoute: () => administracao,
  path: "usuarios",
  validateSearch: z.object({
    busca: textoOpcional,
    papel: z
      .enum(Object.values(PapelEnum) as [PapelEnum, ...PapelEnum[]])
      .optional()
      .catch(undefined),
    situacao: z.enum(["ativos", "desativados"]).optional().catch(undefined),
    pagina: paginaOpcional,
  }),
  component: () => (
    <Exige permissao="admin.usuarios">
      <UsuariosPagina />
    </Exige>
  ),
});

const usuarioDetalhe = createRoute({
  getParentRoute: () => administracao,
  path: "usuarios/$id",
  component: () => (
    <Exige permissao="admin.usuarios">
      <UsuarioDetalhePagina />
    </Exige>
  ),
});

const equipes = createRoute({
  getParentRoute: () => administracao,
  path: "equipes",
  component: () => (
    <Exige permissao="admin.equipes">
      <EquipesPagina />
    </Exige>
  ),
});

const territorios = createRoute({
  getParentRoute: () => administracao,
  path: "territorios",
  component: () => (
    <Exige permissao="admin.territorios">
      <TerritoriosPagina />
    </Exige>
  ),
});

const dataOpcional = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

const auditoria = createRoute({
  getParentRoute: () => administracao,
  path: "auditoria",
  validateSearch: z.object({
    entidade: textoOpcional,
    origem: textoOpcional,
    objeto: textoOpcional,
    desde: dataOpcional,
    ate: dataOpcional,
    pagina: paginaOpcional,
  }),
  component: () => (
    <Exige permissao="admin.auditoria">
      <AuditoriaPagina />
    </Exige>
  ),
});

const modulosFuturos = MODULOS.filter((m) => m.id !== "administracao").map((m) =>
  createRoute({
    getParentRoute: () => autenticado,
    path: m.caminho.slice(1),
    component: () => <ModuloFuturo modulo={m} />,
  }),
);

const arvore = raiz.addChildren([
  autenticado.addChildren([
    inicio,
    administracao.addChildren([
      administracaoInicio,
      usuarios,
      usuarioDetalhe,
      equipes,
      territorios,
      auditoria,
    ]),
    ...modulosFuturos,
  ]),
]);

export function criarRoteador(history?: RouterHistory) {
  return createRouter({ routeTree: arvore, defaultPreload: "intent", history });
}

export const roteador = criarRoteador();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof roteador;
  }
}
