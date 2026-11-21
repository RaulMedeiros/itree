/** Quatro divisões "redondas" entre 0 e o máximo, para os eixos. */
export function marcas(maximo: number, n = 4): number[] {
  if (maximo <= 0) return [0];
  const bruto = maximo / n;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto) ?? bruto;
  const saida: number[] = [];
  for (let v = 0; v <= maximo + passo * 0.001; v += passo) saida.push(Number(v.toFixed(6)));
  return saida;
}
