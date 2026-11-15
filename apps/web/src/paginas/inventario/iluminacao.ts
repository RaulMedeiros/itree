/** Texto da lista "Árvores próximas à iluminação" (poste × copa). Funções puras. */
import { faixaDeAltura, textoDoPoste } from "../../mapa/iluminacao";

export const AVISO_RAIO_PROVISORIO = "raio provisório, a definir pela URBFOR e pela SEINF";

/** Faixa da fonte pelo máximo da faixa: 5 vira "até 5 m"; 10, "5 a 10 m"; 14, "11 a 14 m". */
const FAIXAS: Record<number, [number | undefined, number]> = {
  5: [undefined, 5],
  10: [5, 10],
  14: [11, 14],
  17: [15, 17],
  25: [18, 25],
};

export function rotuloDaAltura(maximo: number): string {
  const faixa = FAIXAS[maximo];
  return faixa ? faixaDeAltura(faixa[0], faixa[1]) : `até ${maximo.toLocaleString("pt-BR")} m`;
}

export const formatarDistancia = (metros: number) =>
  `${metros.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`;

/** "Concreto Duplo T, 5 a 10 m" do poste mais próximo, como a API o devolve. */
export const descricaoDoPoste = (p: {
  tipo: string;
  altura_min_m: number | null;
  altura_max_m: number | null;
}) => textoDoPoste(p.tipo, p.altura_min_m, p.altura_max_m);
