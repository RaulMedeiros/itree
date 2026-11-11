/**
 * Glossário do domínio (G-06). Cada definição vem das specs em docs/specs e não cria regra
 * nova: `regras` aponta as regras de origem e só aparece, como detalhe técnico, para
 * administradores (R2-14).
 */
export type IdTermo =
  | "registro_valido"
  | "condicao_aparente"
  | "origem_localizacao"
  | "risco_confirmado"
  | "prioridade_operacional"
  | "escopo_territorial"
  | "sugestao_ia"
  | "fonte_externa"
  | "alerta_ambiental";

export interface Termo {
  id: IdTermo;
  termo: string;
  /** Definição curta, a que aparece ao clicar no "?" ao lado do termo. */
  definicao: string;
  /** Complementos mostrados só na página Ajuda. */
  detalhes?: string[];
  /** Regras das specs em que a definição se apoia. */
  regras: string[];
}

export const GLOSSARIO: Termo[] = [
  {
    id: "registro_valido",
    termo: "Registro válido",
    definicao:
      "Árvore com identificador, com localização de origem conhecida e que não foi excluída nem fundida a outra. É a base dos indicadores da visão geral.",
    detalhes: [
      "O critério oficial dos indicadores ainda está em definição pela prefeitura e pode mudar.",
    ],
    regras: ["RN-INV-001", "DP-14"],
  },
  {
    id: "condicao_aparente",
    termo: "Condição aparente",
    definicao:
      "O que foi observado na árvore por quem a viu, em campo ou no registro. Não é diagnóstico nem laudo, e não é deduzida sem inspeção ou evidência.",
    detalhes: [
      "Árvore sem inspeção validada aparece como “Não avaliada”, em cinza: a ausência de dado nunca vira “boa”.",
    ],
    regras: ["RN-INV-005", "RN-OCO-003"],
  },
  {
    id: "origem_localizacao",
    termo: "Origem da localização",
    definicao:
      "Como a posição da árvore foi obtida: GPS de campo (coletada no local), Importada (veio de um inventário ou base externa) ou Estimada (marcada pelo painel, sem medição direta).",
    detalhes: [
      "Há ainda a localização geocodificada, obtida a partir do endereço.",
      "No mapa, cada origem tem um símbolo próprio, e a localização estimada aparece vazada. A precisão exibida nunca é maior que a do dado de origem.",
    ],
    regras: ["RN-MAPA-002", "RN-MAPA-003", "RN-PROV-007"],
  },
  {
    id: "risco_confirmado",
    termo: "Risco confirmado",
    definicao:
      "Conclusão de uma avaliação técnica competente, registrada à parte, com responsável técnico e evidência. Só perfis habilitados registram.",
    detalhes: [
      "Não se confunde com a condição aparente (o que foi observado) nem com a prioridade operacional (definida pela gestão). Linguagem de risco só aparece neste campo.",
    ],
    regras: ["RF-OCO-006", "RN-OCO-003"],
  },
  {
    id: "prioridade_operacional",
    termo: "Prioridade operacional",
    definicao:
      "Ordem de atendimento definida pela gestão ou coordenação. Não é calculada automaticamente a partir da condição aparente.",
    regras: ["RN-OCO-001"],
  },
  {
    id: "escopo_territorial",
    termo: "Escopo territorial",
    definicao:
      "Os territórios (município inteiro, regionais ou bairros) que a sua conta pode ver. Dados fora dele não aparecem em listas, mapas, indicadores nem exportações.",
    detalhes: [
      "O que você pode fazer depende do seu papel e do escopo ao mesmo tempo. O seletor de território no cabeçalho só filtra o que já está no seu escopo.",
    ],
    regras: ["RF-ACL-003"],
  },
  {
    id: "sugestao_ia",
    termo: "Sugestão de IA",
    definicao:
      "Conteúdo produzido por um modelo de IA, sempre identificado como tal. A IA sugere e uma pessoa habilitada decide: a sugestão não sobrescreve um valor confirmado sem ação explícita.",
    detalhes: [
      "Sinais visuais são “possíveis” e pedem avaliação, nunca são diagnóstico. Não há percentual de confiança, porque os modelos ainda não foram calibrados e validados.",
    ],
    regras: ["RN-IA-001", "RN-IA-003", "RN-IA-005", "RN-INV-003"],
  },
  {
    id: "fonte_externa",
    termo: "Fonte externa",
    definicao:
      "Base de terceiros de onde o sistema traz dados, como os focos de calor do INPE. Todo dado externo mostra fonte, data de atualização e limitações conhecidas.",
    detalhes: [
      "Um sinal vindo de fonte externa não prova irregularidade: detecção remota não é confirmação de ilegalidade.",
    ],
    regras: ["RN-PROV-003", "RN-PROV-009"],
  },
  {
    id: "alerta_ambiental",
    termo: "Alerta ambiental",
    definicao:
      "Sinal produzido por uma fonte externa ou algoritmo, que aguarda análise humana. Fica separado das ocorrências até alguém convertê-lo explicitamente.",
    regras: ["RN-OCO-002", "RN-PROV-009"],
  },
];

export const TERMOS: Record<IdTermo, Termo> = Object.fromEntries(
  GLOSSARIO.map((t) => [t.id, t]),
) as Record<IdTermo, Termo>;
