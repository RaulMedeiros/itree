/**
 * Cálculo do cenário "Onde plantar", feito no navegador para os controles responderem na hora.
 *
 * A API entrega, por bairro, o valor bruto e o percentil de prioridade de cada critério (0 a 1,
 * na direção certa). Aqui o cenário só pondera: a pontuação do bairro é a média ponderada dos
 * percentis dos critérios ativos (peso maior que zero, critério disponível) em que ele tem dado.
 * Critério sem dado no bairro é ignorado na média e marcado na linha, nunca tratado como zero.
 * Cenário de priorização, não índice oficial (DP-14).
 */
import type { BairroPlanejamento, CriterioPlanejamento } from "@itree/api-client";

import { gerarCsv } from "../analises/linhas";

export const IDS_CRITERIOS = [
  "arborizacao",
  "densidade",
  "renda",
  "arvores_por_mil",
  "area_verde",
  "ilha_calor",
] as const;
export type CriterioId = (typeof IDS_CRITERIOS)[number];
export type Pesos = Record<CriterioId, number>;

export const PESO_MAXIMO = 5;
export const PESO_PADRAO = 3;
export const TAMANHO_RANKING = 20;
export const CLASSES = 5;

/** Chave de cada peso na URL, para o cenário poder ser compartilhado. */
export const CHAVE_NA_URL: Record<CriterioId, string> = {
  arborizacao: "arborizacao",
  densidade: "densidade",
  renda: "renda",
  arvores_por_mil: "arvores",
  area_verde: "verde",
  ilha_calor: "calor",
};

export type BuscaPesos = Partial<Record<string, number>>;

/** Cor de cada critério na barra empilhada (a legenda e o título de cada trecho dão o nome). */
export const COR_CRITERIO: Record<CriterioId, string> = {
  arborizacao: "#1f6b45",
  densidade: "#6a3f9f",
  renda: "#1d5fa8",
  arvores_por_mil: "#8a5a00",
  area_verde: "#19766f",
  ilha_calor: "#b3261e",
};

export const ROTULO_CURTO: Record<CriterioId, string> = {
  arborizacao: "Arborização do entorno",
  densidade: "Densidade",
  renda: "Renda",
  arvores_por_mil: "Árvores por 1.000 hab.",
  area_verde: "Área verde por hab.",
  ilha_calor: "Ilha de calor",
};

export interface Cenario {
  id: "equilibrado" | "equidade" | "calor_densidade";
  rotulo: string;
  descricao: string;
  pesos: (calorDisponivel: boolean) => Pesos;
}

const todos = (peso: number): Pesos => ({
  arborizacao: peso,
  densidade: peso,
  renda: peso,
  arvores_por_mil: peso,
  area_verde: peso,
  ilha_calor: peso,
});

export const CENARIOS: Cenario[] = [
  {
    id: "equilibrado",
    rotulo: "Equilibrado",
    descricao: "Todos os critérios com o mesmo peso.",
    pesos: () => todos(PESO_PADRAO),
  },
  {
    id: "equidade",
    rotulo: "Equidade",
    descricao: "Peso maior na renda e na arborização do entorno.",
    pesos: () => ({ ...todos(2), renda: PESO_MAXIMO, arborizacao: PESO_MAXIMO - 1 }),
  },
  {
    id: "calor_densidade",
    rotulo: "Calor e densidade",
    descricao:
      "Peso maior na densidade e na ilha de calor; sem os dados de calor, na densidade e na arborização.",
    pesos: (calor) => ({
      ...todos(2),
      densidade: PESO_MAXIMO,
      ...(calor ? { ilha_calor: PESO_MAXIMO } : { arborizacao: PESO_MAXIMO }),
    }),
  },
];

const limitar = (v: unknown): number | undefined => {
  const n = Number(v);
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return undefined;
  return Math.min(PESO_MAXIMO, Math.max(0, Math.round(n)));
};

/** Pesos da URL; o que não está na URL vale o padrão (cenário "Equilibrado"). */
export function pesosDaBusca(busca: BuscaPesos): Pesos {
  const pesos = todos(PESO_PADRAO);
  for (const id of IDS_CRITERIOS) pesos[id] = limitar(busca[CHAVE_NA_URL[id]]) ?? PESO_PADRAO;
  return pesos;
}

/** Só os pesos diferentes do padrão vão para a URL (a URL do cenário "Equilibrado" fica limpa). */
export function buscaDosPesos(pesos: Pesos): Record<string, number | undefined> {
  const saida: Record<string, number | undefined> = {};
  for (const id of IDS_CRITERIOS)
    saida[CHAVE_NA_URL[id]] = pesos[id] === PESO_PADRAO ? undefined : pesos[id];
  return saida;
}

/** O cenário pronto cujos pesos são os atuais (só os critérios disponíveis contam), se houver. */
export function cenarioAtivo(
  pesos: Pesos,
  criterios: CriterioPlanejamento[],
): Cenario["id"] | null {
  const calor = criterios.find((c) => c.id === "ilha_calor")?.disponivel ?? false;
  const disponiveis = IDS_CRITERIOS.filter(
    (id) => criterios.find((c) => c.id === id)?.disponivel ?? false,
  );
  for (const c of CENARIOS) {
    const alvo = c.pesos(calor);
    if (disponiveis.every((id) => pesos[id] === alvo[id])) return c.id;
  }
  return null;
}

export interface LinhaPontuada {
  id: string;
  nome: string;
  /** Média ponderada dos percentis, de 0 a 1; `null` se nenhum critério ativo tem dado. */
  pontuacao: number | null;
  /** Parte da pontuação que veio de cada critério (somam a pontuação). */
  contribuicoes: Partial<Record<CriterioId, number>>;
  /** Critérios ativos em que o bairro não tem dado. */
  semDado: CriterioId[];
}

export function criteriosAtivos(criterios: CriterioPlanejamento[], pesos: Pesos): CriterioId[] {
  return IDS_CRITERIOS.filter(
    (id) => pesos[id] > 0 && (criterios.find((c) => c.id === id)?.disponivel ?? false),
  );
}

export function pontuar(
  bairros: BairroPlanejamento[],
  criterios: CriterioPlanejamento[],
  pesos: Pesos,
): LinhaPontuada[] {
  const ativos = criteriosAtivos(criterios, pesos);
  return bairros.map((b) => {
    const comDado = ativos.filter(
      (id) => b.percentis[id] !== null && b.percentis[id] !== undefined,
    );
    const soma = comDado.reduce((t, id) => t + pesos[id], 0);
    const contribuicoes: Partial<Record<CriterioId, number>> = {};
    let pontuacao: number | null = null;
    if (soma > 0) {
      pontuacao = 0;
      for (const id of comDado) {
        const parte = (pesos[id] * (b.percentis[id] as number)) / soma;
        contribuicoes[id] = parte;
        pontuacao += parte;
      }
    }
    return {
      id: b.id,
      nome: b.nome,
      pontuacao,
      contribuicoes,
      semDado: ativos.filter((id) => !comDado.includes(id)),
    };
  });
}

/** Do mais prioritário ao menos; bairros sem pontuação ficam de fora. Empate: ordem alfabética. */
export function ordenar(linhas: LinhaPontuada[]): LinhaPontuada[] {
  return linhas
    .filter((l) => l.pontuacao !== null)
    .sort(
      (a, b) =>
        (b.pontuacao as number) - (a.pontuacao as number) || a.nome.localeCompare(b.nome, "pt-BR"),
    );
}

/**
 * Classe de cada bairro pontuado (0 a 4; 4 é a maior prioridade), em quintis da posição no
 * ranking: cada classe tem cerca de um quinto dos bairros. `ordenadas` vem de `ordenar`.
 */
export function classesDePrioridade(ordenadas: LinhaPontuada[]): Map<string, number> {
  const n = ordenadas.length;
  const mapa = new Map<string, number>();
  ordenadas.forEach((l, i) => mapa.set(l.id, CLASSES - 1 - Math.floor((i * CLASSES) / n)));
  return mapa;
}

/** Menor e maior pontuação de cada classe, para a legenda. */
export function faixasDasClasses(
  ordenadas: LinhaPontuada[],
  classes: Map<string, number>,
): ({ de: number; ate: number } | null)[] {
  const faixas: ({ de: number; ate: number } | null)[] = Array(CLASSES).fill(null);
  for (const l of ordenadas) {
    const c = classes.get(l.id);
    if (c === undefined || l.pontuacao === null) continue;
    const f = faixas[c];
    faixas[c] = f
      ? { de: Math.min(f.de, l.pontuacao), ate: Math.max(f.ate, l.pontuacao) }
      : { de: l.pontuacao, ate: l.pontuacao };
  }
  return faixas;
}

// --- Formato dos valores ----------------------------------------------------------------------

const num = (v: number, casas: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Valor bruto como a pessoa lê: "45,2%", "9.000 hab/km²", "R$ 1.234", "12,3 m²/hab.", "+3,2 °C". */
export function formatarValor(id: CriterioId, v: number | null | undefined): string {
  if (v === null || v === undefined) return "Sem dado";
  switch (id) {
    case "arborizacao":
      return `${num(v, 1)}%`;
    case "densidade":
      return `${Math.round(v).toLocaleString("pt-BR")} hab/km²`;
    case "renda":
      return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
    case "arvores_por_mil":
      return `${num(v, 2)} por 1.000 hab.`;
    case "area_verde":
      return `${num(v, 1)} m²/hab.`;
    case "ilha_calor":
      return `${v > 0 ? "+" : ""}${num(v, 1)} °C`;
  }
}

/** Pontuação de 0 a 100, com uma casa, como aparece no ranking. */
export const formatarPontuacao = (p: number): string => num(p * 100, 1);

export function fonteDoCriterio(c: CriterioPlanejamento): string {
  return `${c.fonte}${c.ano ? `, ${c.ano}` : ""}`;
}

// --- Exportação ---------------------------------------------------------------------------------

/** CSV do ranking completo, com os pesos e as fontes nas linhas de comentário. */
export function csvDoCenario(
  ordenadas: LinhaPontuada[],
  bairros: BairroPlanejamento[],
  criterios: CriterioPlanejamento[],
  pesos: Pesos,
  geradoEm: string,
): string {
  const porId = new Map(bairros.map((b) => [b.id, b]));
  const colunas = [
    { chave: "posicao", rotulo: "Posição" },
    { chave: "bairro", rotulo: "Bairro" },
    { chave: "pontuacao", rotulo: "Pontuação (0 a 100)" },
    ...IDS_CRITERIOS.flatMap((id) => [
      { chave: `valor_${id}`, rotulo: `${ROTULO_CURTO[id]}: valor` },
      { chave: `percentil_${id}`, rotulo: `${ROTULO_CURTO[id]}: percentil de prioridade (0 a 1)` },
    ]),
    { chave: "sem_dado", rotulo: "Critérios ativos sem dado" },
  ];
  const linhas = ordenadas.map((l, i) => {
    const b = porId.get(l.id);
    const linha: Record<string, unknown> = {
      posicao: i + 1,
      bairro: l.nome,
      pontuacao: Math.round((l.pontuacao ?? 0) * 1000) / 10,
      sem_dado: l.semDado.map((id) => ROTULO_CURTO[id]).join(", "),
    };
    for (const id of IDS_CRITERIOS) {
      linha[`valor_${id}`] = b?.valores[id] ?? null;
      linha[`percentil_${id}`] = b?.percentis[id] ?? null;
    }
    return linha;
  });
  const ativos = criteriosAtivos(criterios, pesos);
  const pesosTexto = IDS_CRITERIOS.map((id) => {
    const c = criterios.find((x) => x.id === id);
    const estado = !c?.disponivel ? " (indisponível)" : "";
    return `${ROTULO_CURTO[id]} ${pesos[id]}${estado}`;
  }).join("; ");
  return gerarCsv(colunas, linhas, {
    titulo: "Cenário de priorização para plantio (Onde plantar), não é índice oficial (DP-14)",
    fonte: criterios
      .filter((c) => ativos.includes(c.id as CriterioId))
      .map((c) => `${ROTULO_CURTO[c.id as CriterioId]}: ${fonteDoCriterio(c)}`)
      .join(" | "),
    calculadoEm: geradoEm,
    ressalvas: [
      `pesos de 0 a ${PESO_MAXIMO}: ${pesosTexto}`,
      "pontuação = média ponderada dos percentis de prioridade dos critérios ativos com dado",
      "critério sem dado no bairro é ignorado na média",
      ...criterios
        .filter((c) => c.ressalva)
        .map((c) => `${ROTULO_CURTO[c.id as CriterioId]}: ${c.ressalva}`),
    ],
  });
}

/** Baixa um texto como arquivo CSV. */
export function baixarCsv(csv: string, nome: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
