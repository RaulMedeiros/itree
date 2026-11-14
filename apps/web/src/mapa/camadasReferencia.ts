/** Texto de popup das camadas de referência (RF-INT-006). Funções puras, sem MapLibre. */

export interface LinhaPopup {
  rotulo: string;
  valor: string;
}

const LIMITE_VALOR = 400;

/** Nome de propriedade como a pessoa lê: "ano_ref" vira "Ano ref". */
export function rotuloDaPropriedade(chave: string): string {
  const texto = chave.replace(/[_-]+/g, " ").trim();
  return texto.charAt(0).toLocaleUpperCase("pt-BR") + texto.slice(1);
}

/**
 * Valor da fonte como texto puro: `<br>` vira quebra de linha e as demais marcações são
 * descartadas. O resultado só entra na tela como texto, nunca como HTML.
 */
export function textoDoValor(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  const bruto = typeof valor === "object" ? JSON.stringify(valor) : String(valor);
  const texto = bruto
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .trim();
  return texto.length > LIMITE_VALOR ? `${texto.slice(0, LIMITE_VALOR)}…` : texto;
}

/**
 * Linhas do popup. Com rótulos cadastrados, só as propriedades listadas aparecem, na ordem dos
 * rótulos (quem administra escolhe o que mostrar); sem rótulos, todas, com o nome legível.
 */
export function linhasDoPopup(
  propriedades: Record<string, unknown>,
  rotulos: Record<string, string>,
): LinhaPopup[] {
  const chaves = Object.keys(rotulos).length ? Object.keys(rotulos) : Object.keys(propriedades);
  const linhas: LinhaPopup[] = [];
  for (const chave of chaves) {
    const valor = textoDoValor(propriedades[chave]);
    if (valor) linhas.push({ rotulo: rotulos[chave] ?? rotuloDaPropriedade(chave), valor });
  }
  return linhas;
}

export const idDaFonte = (id: string) => `ref-${id}`;
export const idsDasCamadas = (id: string) => [
  `${idDaFonte(id)}-area`,
  `${idDaFonte(id)}-linha`,
  `${idDaFonte(id)}-ponto`,
];
