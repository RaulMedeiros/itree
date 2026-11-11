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

/** Graus decimais com vírgula decimal (pt-BR), seis casas. */
export function formatarCoordenada(valor: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}

/** "1 sinal", "3 sinais": singular e plural sem o "(s)" de máquina. */
export function contar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

const diaFortaleza = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const MS_DIA = 86_400_000;

function numeroDoDia(aaaammdd: string): number {
  const [a, m, d] = aaaammdd.split("-").map(Number);
  return Date.UTC(a!, m! - 1, d!) / MS_DIA;
}

/** Dias corridos (calendário de Fortaleza) desde um instante até `agora`. */
export function diasDesde(instante: string, agora: Date = new Date()): number {
  return (
    numeroDoDia(diaFortaleza.format(agora)) - numeroDoDia(diaFortaleza.format(new Date(instante)))
  );
}

/** Prazo (AAAA-MM-DD) em linguagem corrente: "vence em 3 dias", "atrasado há 2 dias". */
export function prazoRestante(
  prazo: string | null | undefined,
  agora: Date = new Date(),
): { texto: string; atrasado: boolean } | null {
  if (!prazo) return null;
  const dias = numeroDoDia(prazo) - numeroDoDia(diaFortaleza.format(agora));
  if (dias < 0) return { texto: `atrasado há ${contar(-dias, "dia", "dias")}`, atrasado: true };
  if (dias === 0) return { texto: "vence hoje", atrasado: false };
  if (dias === 1) return { texto: "vence amanhã", atrasado: false };
  return { texto: `vence em ${dias} dias`, atrasado: false };
}

/** Parque ou unidade de conservação perto de um foco, como a API grava (distância em metros). */
export interface AreaVerdeProxima {
  nome: string;
  tipo: string;
  tipo_rotulo?: string;
  distancia_m: number;
}

/**
 * "a 0,6 km do Parque Estadual do Cocó" ou "dentro de Parque ..."; vazio sem área próxima.
 * Abaixo de 100 m mostra em metros, para não arredondar para "0,0 km".
 */
export function descreverAreaVerdeProxima(area: unknown): string | null {
  if (!area || typeof area !== "object") return null;
  const { nome, distancia_m: metros } = area as Partial<AreaVerdeProxima>;
  if (!nome || typeof metros !== "number") return null;
  if (metros <= 0) return `dentro de ${nome}`;
  const distancia =
    metros < 100
      ? `${metros} m`
      : `${(metros / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  return `a ${distancia} ${contracao(nome)} ${nome}`;
}

const PRIMEIRAS_MASCULINAS = new Set([
  "parque",
  "monumento",
  "refúgio",
  "jardim",
  "bosque",
  "horto",
  "mosaico",
  "corredor",
  "santuário",
  "complexo",
]);
const SIGLAS_FEMININAS = new Set(["apa", "arie", "rppn", "esec", "flona", "rebio", "resex"]);

/** "do", "da" ou "de", pela primeira palavra do nome ("Parque ..." → do, "APA ..." → da). */
function contracao(nome: string): string {
  const primeira = nome.trim().split(/\s+/)[0]!.toLowerCase();
  if (PRIMEIRAS_MASCULINAS.has(primeira)) return "do";
  if (SIGLAS_FEMININAS.has(primeira) || /(a|ã|ção|são)$/.test(primeira)) return "da";
  return "de";
}
