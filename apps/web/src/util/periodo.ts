/** Data local como AAAA-MM-DD (o filtro de período trabalha em dias do calendário). */
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const diasAtras = (hoje: Date, dias: number) =>
  new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - dias);

export interface Periodo {
  inicio?: string;
  fim?: string;
}

/** Atalhos de período; o fim é sempre hoje. */
export const ATALHOS_PERIODO: { rotulo: string; periodo: (hoje: Date) => Periodo }[] = [
  { rotulo: "30 dias", periodo: (h) => ({ inicio: iso(diasAtras(h, 30)), fim: iso(h) }) },
  { rotulo: "12 meses", periodo: (h) => ({ inicio: iso(diasAtras(h, 365)), fim: iso(h) }) },
  {
    rotulo: "Ano",
    periodo: (h) => ({ inicio: iso(new Date(h.getFullYear(), 0, 1)), fim: iso(h) }),
  },
];
