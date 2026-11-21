/** Linha do tempo do mapa: meses no formato `AAAA-MM`, o mesmo da URL e da API. */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export interface MesDaSerie {
  mes: string;
  /** Árvores cadastradas no mês; nulo quando o usuário não pode ler a camada. */
  arvores: number | null;
  /** Ocorrências registradas no mês; nulo sem permissão. */
  ocorrencias: number | null;
  alertas: number | null;
}

export interface SerieTemporal {
  primeiro_mes: string | null;
  ultimo_mes: string;
  meses: MesDaSerie[];
}

export function mesDe(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
}

export function mesAtual(): string {
  return mesDe(new Date());
}

/** "2026-03" → "mar/2026". */
export function rotuloDoMes(mes: string): string {
  const [ano, m] = mes.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${ano}`;
}

/** Soma (ou subtrai) meses de um `AAAA-MM`. */
export function somarMeses(mes: string, n: number): string {
  const [ano, m] = mes.split("-").map(Number) as [number, number];
  const indice = ano * 12 + (m - 1) + n;
  return `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, "0")}`;
}

/** Todos os meses de `primeiro` a `ultimo`, inclusive. */
export function mesesEntre(primeiro: string, ultimo: string): string[] {
  const meses: string[] = [];
  for (let m = primeiro; m <= ultimo && meses.length < 1200; m = somarMeses(m, 1)) meses.push(m);
  return meses;
}

/** Texto do período: "Situação em mar/2026" ou "De jan/2026 a mar/2026". */
export function textoDoPeriodo(ate: string, desde?: string): string {
  return desde
    ? `De ${rotuloDoMes(desde)} a ${rotuloDoMes(ate)}`
    : `Situação em ${rotuloDoMes(ate)}`;
}
