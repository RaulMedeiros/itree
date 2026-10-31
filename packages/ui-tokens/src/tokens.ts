/**
 * Tokens da direção visual C — Field Operations.
 * Fonte única para web (via tokens.css) e app móvel (via este objeto).
 * Pares texto/fundo escolhidos para contraste WCAG 2.2 AA (≥ 4,5:1).
 */
export const cores = {
  fundo: "#f6f7f5",
  superficie: "#ffffff",
  borda: "#d9ddd6",
  texto: "#1b2420",
  textoSuave: "#56615b",
  marca: "#1f6b45",
  marcaEscura: "#16502f",
  marcaClara: "#e3f1e8",
  info: "#1d5fa8",
  infoClara: "#e4eefa",
  atencao: "#8a5a00",
  atencaoClara: "#fcf1d9",
  perigo: "#b3261e",
  perigoClara: "#fbe7e5",
  sucesso: "#1f6b45",
  sucessoClara: "#e3f1e8",
  neutro: "#4a5550",
  neutroClara: "#eceeeb",
} as const;

export const raio = { pequeno: 4, medio: 6, grande: 10 } as const;
export const espaco = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;
