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

/** Concordância de número: `plural(1, "dia")` → "1 dia"; `plural(3, "dia")` → "3 dias". */
export function plural(n: number, singular: string, pluralForma = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

/** dd/mm/aaaa → AAAA-MM-DD; vazio se a data estiver incompleta ou não existir no calendário. */
export function dataBrParaIso(texto: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  if (!m) return "";
  const [, d, mes, a] = m;
  const dt = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  const valida =
    dt.getUTCFullYear() === Number(a) &&
    dt.getUTCMonth() === Number(mes) - 1 &&
    dt.getUTCDate() === Number(d);
  return valida ? `${a}-${mes}-${d}` : "";
}

/** AAAA-MM-DD → dd/mm/aaaa (vazio se o valor não for uma data ISO). */
export function dataIsoParaBr(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Aplica a máscara dd/mm/aaaa à medida que a pessoa digita. */
export function mascararDataBr(texto: string): string {
  const d = texto.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}
