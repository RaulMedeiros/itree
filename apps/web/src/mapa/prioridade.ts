/**
 * Camada coroplética "Prioridade para plantio" da página Planejamento (cenário, não índice oficial).
 *
 * Cinco classes pela posição do bairro no ranking do cenário (quintis: cada classe tem cerca de um
 * quinto dos bairros com pontuação), da menor prioridade à maior. A classe é sempre relativa ao
 * cenário aberto, nunca um valor absoluto: mudar os pesos muda as classes.
 *
 * Paleta: rampa sequencial de um só matiz (ocre, do claro ao castanho). O azul é do Censo, o violeta
 * da população e da renda, o rosa do PRODES e o roxo dos alertas; o verde e o laranja da condição
 * das árvores não aparecem neste mapa. O contraste é conferido por
 * `packages/ui-tokens/scripts/contraste.mjs`: classes vizinhas a ≥ 1,4:1 e a mais escura a ≥ 3:1
 * sobre o mapa base, em cada fundo do OSM.
 */
export const CORES_PRIORIDADE = ["#fcf3d3", "#ecbb4c", "#d68a2c", "#ad5c16", "#6e3410"] as const;
export const OPACIDADE_PRIORIDADE = 0.8;

export const ROTULOS_CLASSES_PRIORIDADE = [
  "Menor prioridade (20% últimos)",
  "Prioridade baixa",
  "Prioridade média",
  "Prioridade alta",
  "Maior prioridade (20% primeiros)",
] as const;

/** Bairro sem nenhum critério ativo com dado: hachura cinza, como nas outras camadas. */
export const COR_SEM_PONTUACAO = "#a3ada7";
export const COR_SELECAO_PRIORIDADE = "#0b7285";
