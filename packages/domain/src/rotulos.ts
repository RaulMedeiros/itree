/**
 * Rótulos em português para os vocabulários definidos no backend.
 *
 * Os tipos vêm do contrato OpenAPI: se o backend criar um papel ou permissão
 * novo, a compilação falha aqui até o rótulo ser adicionado. Isso mantém os
 * termos idênticos em web, app e API (specs/README, "Linguagem obrigatória").
 */
import type { PapelEnum, PermissaoEnum, TipoTerritorioEnum } from "@itree/api-client";

export const ROTULOS_PAPEL: Record<PapelEnum, string> = {
  gestor: "Gestor municipal",
  coordenador: "Coordenador de equipe",
  revisor: "Técnico revisor",
  analista_ambiental: "Analista ambiental",
  tecnico: "Técnico de campo",
  consulta: "Consulta",
  administrador: "Administrador",
};

export const DESCRICOES_PAPEL: Record<PapelEnum, string> = {
  gestor: "Indicadores, priorização, relatórios e visão territorial.",
  coordenador: "Distribuição de tarefas e acompanhamento de pendências.",
  revisor: "Revisão e validação de inspeções e espécies.",
  analista_ambiental: "Triagem de alertas ambientais e encaminhamento.",
  tecnico: "Consulta no web; o uso principal é no aplicativo de campo.",
  consulta: "Leitura restrita, sem edição.",
  administrador: "Usuários, papéis, catálogos, integrações e auditoria.",
};

export const ROTULOS_PERMISSAO: Record<PermissaoEnum, string> = {
  "mapa.ler": "Ver mapa",
  "inventario.ler": "Ver inventário",
  "inventario.editar": "Cadastrar e editar árvores",
  "inventario.fundir_excluir": "Fundir ou excluir árvores",
  "inventario.importar": "Importar inventário em lote",
  "inspecoes.ler": "Ver inspeções",
  "inspecoes.validar": "Revisar e validar inspeções",
  "ocorrencias.ler": "Ver ocorrências",
  "ocorrencias.editar": "Registrar e editar ocorrências",
  "ocorrencias.priorizar": "Definir prioridade operacional",
  "ocorrencias.confirmar_risco": "Registrar risco confirmado",
  "alertas.ler": "Ver alertas ambientais",
  "alertas.triar": "Triar alertas ambientais",
  "tarefas.ler": "Ver equipes e tarefas",
  "tarefas.editar": "Criar e atribuir tarefas",
  "relatorios.ler": "Ver análises e relatórios",
  "relatorios.exportar": "Exportar dados",
  "admin.usuarios": "Administrar usuários e papéis",
  "admin.equipes": "Administrar equipes",
  "admin.auditoria": "Consultar auditoria",
  "admin.territorios": "Administrar territórios",
  "admin.configuracao": "Administrar catálogos e integrações",
};

export const ROTULOS_TIPO_TERRITORIO: Record<TipoTerritorioEnum, string> = {
  municipio: "Município",
  regional: "Regional",
  bairro: "Bairro",
};

export const ROTULOS_ACAO_AUDITORIA: Record<string, string> = {
  criacao: "Criação",
  alteracao: "Alteração",
  exclusao: "Exclusão",
};

export const ROTULOS_ORIGEM: Record<string, string> = {
  web: "Painel web",
  app: "Aplicativo",
  api: "API / sistema",
  cli: "Linha de comando",
};
