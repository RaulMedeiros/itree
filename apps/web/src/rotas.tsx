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
import { EspeciesPagina, TiposOcorrenciaPagina } from "./paginas/administracao/CatalogosPaginas";
import { ArvoreDetalhePagina } from "./paginas/inventario/ArvoreDetalhePagina";
import { ArvoresPagina } from "./paginas/inventario/ArvoresPagina";
import { DuplicidadesPagina } from "./paginas/inventario/DuplicidadesPagina";
import { ImportacoesPagina } from "./paginas/inventario/ImportacoesPagina";
import { LayoutInventario } from "./paginas/inventario/LayoutInventario";
import { MapaPagina } from "./paginas/mapa/MapaPagina";
import { OcorrenciaDetalhePagina } from "./paginas/ocorrencias/OcorrenciaDetalhePagina";
import { OcorrenciasPagina } from "./paginas/ocorrencias/OcorrenciasPagina";
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

const especies = createRoute({
  getParentRoute: () => administracao,
  path: "especies",
  component: () => (
    <Exige permissao="admin.configuracao">
      <EspeciesPagina />
    </Exige>
  ),
});

const tiposOcorrencia = createRoute({
  getParentRoute: () => administracao,
  path: "tipos-ocorrencia",
  component: () => (
    <Exige permissao="admin.configuracao">
      <TiposOcorrenciaPagina />
    </Exige>
  ),
});

// --- F1: mapa, inventário e ocorrências ---------------------------------------

const numeroOpcional = z.coerce.number().optional().catch(undefined);

const mapa = createRoute({
  getParentRoute: () => autenticado,
  path: "mapa",
  validateSearch: z.object({
    lon: numeroOpcional,
    lat: numeroOpcional,
    zoom: numeroOpcional,
    base: z.enum(["ruas", "satelite"]).optional().catch(undefined),
    camada: z.enum(["arvores", "ocorrencias"]).optional().catch(undefined),
    arvores: z.literal("0").optional().catch(undefined),
    ocorrencias: z.literal("0").optional().catch(undefined),
    bairros: z.literal("0").optional().catch(undefined),
    especie_estado: z
      .enum(["confirmada", "sugerida_ia", "informada", "nao_identificada"])
      .optional()
      .catch(undefined),
    localizacao_origem: z
      .enum(["gps_campo", "importada", "estimada_web", "geocodificada"])
      .optional()
      .catch(undefined),
    estado: z.enum(["abertas", "todas"]).optional().catch(undefined),
    selecao: textoOpcional,
  }),
  component: () => (
    <Exige permissao="mapa.ler">
      <MapaPagina />
    </Exige>
  ),
});

const inventario = createRoute({
  getParentRoute: () => autenticado,
  path: "inventario",
  component: () => (
    <Exige permissao="inventario.ler">
      <LayoutInventario />
    </Exige>
  ),
});

const inventarioInicio = createRoute({
  getParentRoute: () => inventario,
  path: "/",
  component: () => <Navigate to="/inventario/arvores" replace />,
});

const arvores = createRoute({
  getParentRoute: () => inventario,
  path: "arvores",
  validateSearch: z.object({
    busca: textoOpcional,
    especie: textoOpcional,
    especie_estado: z
      .enum(["confirmada", "sugerida_ia", "informada", "nao_identificada"])
      .optional()
      .catch(undefined),
    bairro: textoOpcional,
    localizacao_origem: z
      .enum(["gps_campo", "importada", "estimada_web", "geocodificada"])
      .optional()
      .catch(undefined),
    situacao: z.enum(["ativa", "excluida", "fundida", "todas"]).optional().catch(undefined),
    pagina: paginaOpcional,
  }),
  component: ArvoresPagina,
});

const arvoreDetalhe = createRoute({
  getParentRoute: () => inventario,
  path: "arvores/$id",
  component: ArvoreDetalhePagina,
});

const importacoes = createRoute({
  getParentRoute: () => inventario,
  path: "importacoes",
  component: () => (
    <Exige permissao="inventario.importar">
      <ImportacoesPagina />
    </Exige>
  ),
});

const duplicidades = createRoute({
  getParentRoute: () => inventario,
  path: "duplicidades",
  component: DuplicidadesPagina,
});

const ocorrencias = createRoute({
  getParentRoute: () => autenticado,
  path: "ocorrencias",
  component: () => (
    <Exige permissao="ocorrencias.ler">
      <Outlet />
    </Exige>
  ),
});

const ocorrenciasLista = createRoute({
  getParentRoute: () => ocorrencias,
  path: "/",
  validateSearch: z.object({
    busca: textoOpcional,
    estado: textoOpcional,
    tipo: textoOpcional,
    prioridade: z.enum(["baixa", "media", "alta", "urgente", "sem"]).optional().catch(undefined),
    bairro: textoOpcional,
    equipe: textoOpcional,
    atrasadas: z.literal("true").optional().catch(undefined),
    pagina: paginaOpcional,
  }),
  component: OcorrenciasPagina,
});

const ocorrenciaDetalhe = createRoute({
  getParentRoute: () => ocorrencias,
  path: "$id",
  component: OcorrenciaDetalhePagina,
});

const ENTREGUES = new Set(["administracao", "mapa", "inventario", "ocorrencias"]);

const modulosFuturos = MODULOS.filter((m) => !ENTREGUES.has(m.id)).map((m) =>
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
      especies,
      tiposOcorrencia,
      auditoria,
    ]),
    mapa,
    inventario.addChildren([inventarioInicio, arvores, arvoreDetalhe, importacoes, duplicidades]),
    ocorrencias.addChildren([ocorrenciasLista, ocorrenciaDetalhe]),
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
