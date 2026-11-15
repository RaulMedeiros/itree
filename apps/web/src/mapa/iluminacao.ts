/** Texto do ponto de iluminação pública (SEINF) clicado no mapa. Funções puras, sem MapLibre. */

/** Atribuição exigida pela licença CC BY-SA do conjunto de dados. */
export const ATRIBUICAO_ILUMINACAO = "Prefeitura de Fortaleza, SEINF, dados abertos (CC BY-SA)";

/** Propriedades do ponto no tile MVT (`mapa/tiles/iluminacao`); altura -1 = não informada. */
export interface PontoIluminacaoTile {
  id: string;
  logradouro?: string;
  poste?: string;
  altura_min_m?: number;
  altura_max_m?: number;
  lampadas?: string;
}

/** "HERACLITO GRACA, AV" vira "Heraclito Graca, Av": a fonte vem toda em maiúsculas. */
export function capitalizar(texto: string): string {
  const pequenas = new Set(["de", "da", "do", "das", "dos", "e"]);
  return texto
    .toLocaleLowerCase("pt-BR")
    .split(/(\s+)/)
    .map((p, i) =>
      i > 0 && pequenas.has(p) ? p : p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1),
    )
    .join("");
}

const medida = (v: number) => v.toLocaleString("pt-BR");

/** "5 a 10 m", "até 5 m" ou "" quando a fonte não informa a faixa. */
export function faixaDeAltura(min?: number | null, max?: number | null): string {
  const tem = (v?: number | null): v is number => v !== undefined && v !== null && v >= 0;
  if (tem(min) && tem(max)) return `${medida(min)} a ${medida(max)} m`;
  if (tem(max)) return `até ${medida(max)} m`;
  return "";
}

/** "Concreto duplo T, 5 a 10 m"; sem tipo nem faixa, "Não informado". */
export function textoDoPoste(
  tipo?: string | null,
  min?: number | null,
  max?: number | null,
): string {
  const partes = [tipo ? capitalizar(tipo) : "", faixaDeAltura(min, max)];
  return partes.filter(Boolean).join(", ") || "Não informado";
}

/** As lâmpadas ("SODIO 400 W (2); LED 100 W") como lista de itens, ou vazio. */
export function listaDeLampadas(lampadas?: string | null): string[] {
  return (lampadas ?? "")
    .split(";")
    .map((l) => l.trim())
    .filter(Boolean);
}
