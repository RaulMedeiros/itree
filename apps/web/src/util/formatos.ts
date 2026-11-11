const FUSO = "America/Fortaleza";

const dataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  dateStyle: "short",
  timeStyle: "short",
});
const data = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, dateStyle: "short" });

/** dd/mm/aaaa hh:mm no fuso de Fortaleza (RNF-I18N-002). */
export function formatarDataHora(valor: string | null | undefined): string | null {
  return valor ? dataHora.format(new Date(valor)) : null;
}

/** Datas sem hora (AAAA-MM-DD) são exibidas sem conversão de fuso. */
export function formatarData(valor: string | null | undefined): string | null {
  if (!valor) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [a, m, d] = valor.split("-");
    return `${d}/${m}/${a}`;
  }
  return data.format(new Date(valor));
}

/** AAAA-MM-DD como dd/mm/aa, sem conversão de fuso. */
export function formatarDataCurta(valor: string): string {
  const [a, m, d] = valor.split("-");
  return `${d}/${m}/${(a ?? "").slice(2)}`;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** Dias de `prazo` (AAAA-MM-DD) em relação a hoje no fuso de Fortaleza; negativo = atrasado. */
export function diasAtePrazo(prazo: string, agora: Date = new Date()): number {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(agora);
  return Math.round((Date.parse(`${prazo}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / DIA_MS);
}

/** "faltam 19 dias", "vence hoje" ou "atrasado há 3 dias". */
export function descreverPrazo(prazo: string, agora?: Date): string {
  const d = diasAtePrazo(prazo, agora);
  if (d === 0) return "vence hoje";
  const n = Math.abs(d);
  const dias = n === 1 ? "1 dia" : `${n} dias`;
  if (d > 0) return d === 1 ? "falta 1 dia" : `faltam ${dias}`;
  return `atrasado há ${dias}`;
}
