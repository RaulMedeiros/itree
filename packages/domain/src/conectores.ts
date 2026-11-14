import type {
  DestinoConectorEnum,
  ModoEnum,
  PeriodicidadeEnum,
  TipoConectorEnum,
} from "@itree/api-client";

export const ROTULOS_TIPO_CONECTOR: Record<TipoConectorEnum, string> = {
  geojson_url: "GeoJSON por endereço",
  wfs: "WFS (GetFeature em GeoJSON)",
  arcgis_rest: "ArcGIS REST (FeatureServer/MapServer)",
  ckan: "Portal CKAN (recurso GeoJSON ou CSV)",
};

export const ROTULOS_DESTINO_CONECTOR: Record<DestinoConectorEnum, string> = {
  camada_referencia: "Camada de referência no mapa",
  lote_importacao: "Lote de importação (prévia)",
};

export const ROTULOS_PERIODICIDADE: Record<PeriodicidadeEnum, string> = {
  manual: "Manual",
  diaria: "Diária",
  semanal: "Semanal",
  mensal: "Mensal",
};

export const ROTULOS_MODO_CONECTOR: Record<ModoEnum, string> = {
  criar: "Criar só as novas",
  atualizar: "Criar as novas e atualizar as existentes",
};

/** Estado da última sincronização, como a pessoa lê e com o tom do selo. */
export const SITUACAO_CONECTOR: Record<
  string,
  { rotulo: string; tom: "neutro" | "sucesso" | "perigo" | "atencao" | "info" }
> = {
  nunca: { rotulo: "Nunca sincronizado", tom: "neutro" },
  sincronizando: { rotulo: "Sincronizando", tom: "info" },
  ok: { rotulo: "Em dia", tom: "sucesso" },
  falha: { rotulo: "Falhou", tom: "perigo" },
  atrasado: { rotulo: "Atrasado", tom: "atencao" },
};
