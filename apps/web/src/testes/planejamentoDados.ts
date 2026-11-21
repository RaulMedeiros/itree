import type {
  BairroPlanejamento,
  CriterioPlanejamento,
  CriteriosPlanejamento,
} from "@itree/api-client";

const base = {
  descricao: "",
  disponivel: true,
  motivo_indisponivel: "",
  ressalva: "",
  provisorio: false,
  metodo: "",
  bairros_com_dado: 4,
  minimo: 0,
  maximo: 1,
  fonte_url: "",
  licenca: "",
  ano: 2022,
} as const;

export function criteriosDeTeste(comCalor: boolean): CriterioPlanejamento[] {
  return [
    {
      ...base,
      id: "arborizacao",
      nome: "Pouca arborização do entorno",
      unidade: "% de faces de quadra com árvore",
      direcao: "baixo",
      fonte: "IBGE, Censo Demográfico 2022",
    },
    {
      ...base,
      id: "densidade",
      nome: "Alta densidade populacional",
      unidade: "hab/km²",
      direcao: "alto",
      fonte: "IBGE, Censo Demográfico 2022 (densidade)",
    },
    {
      ...base,
      id: "renda",
      nome: "Baixo rendimento do responsável",
      unidade: "R$",
      direcao: "baixo",
      fonte: "IBGE, Censo Demográfico 2022 (renda)",
    },
    {
      ...base,
      id: "arvores_por_mil",
      nome: "Poucas árvores cadastradas por 1.000 habitantes",
      unidade: "por 1.000 hab.",
      direcao: "baixo",
      provisorio: true,
      ressalva: "Conta só as árvores cadastradas; um valor baixo pode indicar falta de cadastro.",
      fonte: "Inventário da plataforma",
    },
    {
      ...base,
      id: "area_verde",
      nome: "Pouca área verde por habitante",
      unidade: "m²/hab.",
      direcao: "baixo",
      fonte: "Fortaleza em Mapas (Ipplan)",
      ano: 2019,
    },
    {
      ...base,
      id: "ilha_calor",
      nome: "Ilha de calor de superfície",
      unidade: "°C",
      direcao: "alto",
      disponivel: comCalor,
      motivo_indisponivel: comCalor ? "" : "Aguardando autorização de uso dos dados do UrbVerde.",
      fonte: "UrbVerde (IAU-USP)",
      ano: 2025,
    },
  ];
}

type Nulavel = number | null;
function bairro(
  id: string,
  nome: string,
  p: [Nulavel, Nulavel, Nulavel, Nulavel, Nulavel, Nulavel],
  v: [Nulavel, Nulavel, Nulavel, Nulavel, Nulavel, Nulavel],
): BairroPlanejamento {
  const ids = ["arborizacao", "densidade", "renda", "arvores_por_mil", "area_verde", "ilha_calor"];
  return {
    id,
    nome,
    percentis: Object.fromEntries(ids.map((c, i) => [c, p[i] ?? null])),
    valores: Object.fromEntries(ids.map((c, i) => [c, v[i] ?? null])),
  };
}

/**
 * Quatro bairros: "Pobre" é o mais prioritário em renda e em arborização; "Denso" em densidade;
 * "Quente" em calor (quando há calor); "Sem renda" não tem renda nem calor.
 */
export function bairrosDeTeste(): BairroPlanejamento[] {
  return [
    bairro("b-pobre", "Pobre", [0.9, 0.3, 1, 0.5, 0.5, 0.2], [31.5, 2000, 900, 0.4, 5.5, 0.5]),
    bairro("b-denso", "Denso", [0.4, 1, 0.3, 0.5, 0.5, 0.4], [52.0, 12000, 5200, 0.4, 5.5, 1.5]),
    bairro("b-quente", "Quente", [0.2, 0.4, 0.2, 0.5, 0.5, 1], [60.0, 3000, 6000, 0.4, 5.5, 4.2]),
    bairro(
      "b-sem-renda",
      "Sem renda",
      [0.5, 0.5, null, 0.5, 0.5, null],
      [48.0, 4000, null, 0.4, 5.5, null],
    ),
  ];
}

export function respostaDeTeste(comCalor: boolean): CriteriosPlanejamento {
  return {
    gerado_em: "2026-11-21T12:00:00Z",
    aviso: "Cenário de priorização, não índice oficial.",
    metodo_percentil: "Posição entre os bairros.",
    criterios: criteriosDeTeste(comCalor),
    bairros: bairrosDeTeste(),
  };
}
