import type { PermissaoEnum } from "@itree/api-client";
import {
  BarChart3,
  ClipboardCheck,
  LayoutDashboard,
  ListTree,
  Map,
  Settings,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

export type Fase = "F0" | "F1" | "F2" | "F3";

export interface Modulo {
  id: string;
  rotulo: string;
  caminho: string;
  icone: LucideIcon;
  fase: Fase;
  /** Basta uma das permissões para ver o módulo. */
  permissoes: PermissaoEnum[];
  spec: string;
}

/** Navegação principal do painel web (W-01 §2). */
export const MODULOS: Modulo[] = [
  {
    id: "visao-geral",
    rotulo: "Visão geral",
    caminho: "/visao-geral",
    icone: LayoutDashboard,
    fase: "F2",
    permissoes: ["relatorios.ler", "inventario.ler"],
    spec: "W-06",
  },
  {
    id: "mapa",
    rotulo: "Mapa",
    caminho: "/mapa",
    icone: Map,
    fase: "F1",
    permissoes: ["mapa.ler"],
    spec: "W-02",
  },
  {
    id: "inventario",
    rotulo: "Inventário",
    caminho: "/inventario",
    icone: ListTree,
    fase: "F1",
    permissoes: ["inventario.ler"],
    spec: "W-03",
  },
  {
    id: "inspecoes",
    rotulo: "Inspeções",
    caminho: "/inspecoes",
    icone: ClipboardCheck,
    fase: "F2",
    permissoes: ["inspecoes.ler"],
    spec: "W-05",
  },
  {
    id: "ocorrencias",
    rotulo: "Ocorrências",
    caminho: "/ocorrencias",
    icone: TriangleAlert,
    fase: "F1",
    permissoes: ["ocorrencias.ler", "alertas.ler"],
    spec: "W-04 / W-08",
  },
  {
    id: "equipes-tarefas",
    rotulo: "Equipes e tarefas",
    caminho: "/equipes-tarefas",
    icone: Users,
    fase: "F2",
    permissoes: ["tarefas.ler"],
    spec: "W-07",
  },
  {
    id: "analises",
    rotulo: "Análises e relatórios",
    caminho: "/analises",
    icone: BarChart3,
    fase: "F3",
    permissoes: ["relatorios.ler"],
    spec: "W-09",
  },
  {
    id: "administracao",
    rotulo: "Administração",
    caminho: "/administracao",
    icone: Settings,
    fase: "F0",
    permissoes: [
      "admin.usuarios",
      "admin.equipes",
      "admin.auditoria",
      "admin.territorios",
      "admin.configuracao",
    ],
    spec: "W-10",
  },
];

/** Fases já entregues. Módulos de fases futuras não aparecem em produção (RF-SHELL-001). */
export const FASES_ENTREGUES: Fase[] = ["F0", "F1"];

export function modulosVisiveis(
  permissoes: readonly string[],
  mostrarFuturos: boolean,
): (Modulo & { entregue: boolean })[] {
  return MODULOS.filter((m) => m.permissoes.some((p) => permissoes.includes(p)))
    .map((m) => ({ ...m, entregue: FASES_ENTREGUES.includes(m.fase) }))
    .filter((m) => m.entregue || mostrarFuturos);
}

export interface SecaoAdmin {
  id: string;
  rotulo: string;
  caminho: string;
  permissao: PermissaoEnum;
}

export const SECOES_ADMIN: SecaoAdmin[] = [
  {
    id: "usuarios",
    rotulo: "Usuários",
    caminho: "/administracao/usuarios",
    permissao: "admin.usuarios",
  },
  {
    id: "equipes",
    rotulo: "Equipes",
    caminho: "/administracao/equipes",
    permissao: "admin.equipes",
  },
  {
    id: "territorios",
    rotulo: "Territórios",
    caminho: "/administracao/territorios",
    permissao: "admin.territorios",
  },
  {
    id: "especies",
    rotulo: "Espécies",
    caminho: "/administracao/especies",
    permissao: "admin.configuracao",
  },
  {
    id: "tipos-ocorrencia",
    rotulo: "Tipos de ocorrência",
    caminho: "/administracao/tipos-ocorrencia",
    permissao: "admin.configuracao",
  },
  {
    id: "auditoria",
    rotulo: "Auditoria",
    caminho: "/administracao/auditoria",
    permissao: "admin.auditoria",
  },
];
