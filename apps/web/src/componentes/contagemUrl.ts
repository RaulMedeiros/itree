import type { Contagem } from "@itree/domain";

/** Valor lido da URL: só "todas" ou "confirmadas"; qualquer outro vira o padrão. */
export function contagemDaUrl(valor: unknown): Contagem {
  return valor === "confirmadas" ? "confirmadas" : "todas";
}

/** Parâmetro da API: o padrão ("todas") não precisa ir na requisição. */
export function paramContagem(valor: Contagem | undefined) {
  return valor === "confirmadas" ? ({ contagem: "confirmadas" } as const) : {};
}
