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
