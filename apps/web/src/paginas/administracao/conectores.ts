import type { TipoConectorEnum } from "@itree/api-client";

/** Parâmetros que cada tipo de conector pede, com o texto que a tela mostra. */
export interface CampoParametro {
  nome: string;
  rotulo: string;
  ajuda?: string;
  obrigatorio?: boolean;
}

export const CAMPO_ID: CampoParametro = {
  nome: "campo_id",
  rotulo: "Propriedade do identificador",
  ajuda: "Nome da propriedade que identifica cada feição de forma estável (ex.: id).",
};

export const PARAMETROS_POR_TIPO: Record<TipoConectorEnum, CampoParametro[]> = {
  geojson_url: [CAMPO_ID],
  wfs: [
    {
      nome: "camada",
      rotulo: "Camada (typeName)",
      ajuda: "Nome da camada no WFS, como em workspace:camada.",
      obrigatorio: true,
    },
    CAMPO_ID,
  ],
  arcgis_rest: [
    {
      nome: "where",
      rotulo: "Filtro (where)",
      ajuda: "Opcional. Em branco, busca todas as feições (1=1).",
    },
    {
      nome: "tamanho_pagina",
      rotulo: "Feições por página",
      ajuda: "Opcional. Padrão 1000, máximo 5000.",
    },
    CAMPO_ID,
  ],
  ckan: [
    {
      nome: "pacote",
      rotulo: "Conjunto de dados (pacote)",
      ajuda: "Identificador do conjunto no portal CKAN.",
      obrigatorio: true,
    },
    {
      nome: "recurso",
      rotulo: "Recurso",
      ajuda: "Opcional. Em branco, usa o primeiro recurso GeoJSON ou, na falta, o primeiro CSV.",
    },
    CAMPO_ID,
    { nome: "coluna_latitude", rotulo: "Coluna de latitude (CSV)" },
    { nome: "coluna_longitude", rotulo: "Coluna de longitude (CSV)" },
  ],
};

/** "propriedade: Rótulo", uma por linha → objeto. Linhas sem os dois lados são ignoradas. */
export function lerRotulos(texto: string): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const linha of texto.split("\n")) {
    const i = linha.indexOf(":");
    if (i < 0) continue;
    const chave = linha.slice(0, i).trim();
    const rotulo = linha.slice(i + 1).trim();
    if (chave && rotulo) saida[chave] = rotulo;
  }
  return saida;
}

export function escreverRotulos(rotulos: Record<string, string> | undefined): string {
  return Object.entries(rotulos ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

export function resumoExecucao(e: {
  recebidos: number;
  novos: number;
  atualizados: number;
  removidos: number;
  invalidos: number;
}): string {
  return `${e.recebidos} recebidos · ${e.novos} novos · ${e.atualizados} atualizados · ${e.removidos} removidos · ${e.invalidos} inválidos`;
}
