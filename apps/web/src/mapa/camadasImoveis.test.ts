import { describe, expect, it, vi } from "vitest";

import {
  CAMADAS_EDIFICACOES,
  CAMADAS_MACROZONEAMENTO,
  CAMADAS_USO_LOTE,
  URL_TILES_USO_LOTE,
  ZOOM_EDIFICACOES,
  adicionarCamadasImoveis,
  corDaMacrozona,
  definirVisibilidade,
} from "./camadasImoveis";

function mapaFalso() {
  const camadas: Record<string, { minzoom?: number; visibilidade?: string }> = {};
  const fontes: string[] = [];
  const m = {
    addSource: vi.fn((id: string) => fontes.push(id)),
    addLayer: vi.fn((c: { id: string; minzoom?: number; layout?: { visibility: string } }) => {
      camadas[c.id] = { minzoom: c.minzoom, visibilidade: c.layout?.visibility };
    }),
    getLayer: (id: string) => camadas[id],
    setLayoutProperty: (id: string, _p: string, v: string) => {
      camadas[id]!.visibilidade = v;
    },
  };
  return { m, camadas, fontes };
}

describe("camadas de imóveis e uso do solo", () => {
  it("nascem desligadas e as edificações só aparecem a partir do zoom 15", () => {
    const { m, camadas, fontes } = mapaFalso();
    adicionarCamadasImoveis(m as never);
    expect(fontes).toEqual(["uso-lote", "macrozoneamento", "edificacoes"]);
    for (const id of [...CAMADAS_EDIFICACOES, ...CAMADAS_USO_LOTE, ...CAMADAS_MACROZONEAMENTO])
      expect(camadas[id]?.visibilidade).toBe("none");
    expect(ZOOM_EDIFICACOES).toBe(15);
    for (const id of CAMADAS_EDIFICACOES) expect(camadas[id]?.minzoom).toBe(15);
  });

  it("liga e desliga cada grupo", () => {
    const { m, camadas } = mapaFalso();
    adicionarCamadasImoveis(m as never);
    definirVisibilidade(m as never, CAMADAS_EDIFICACOES, true);
    expect(camadas["edificacoes-preenchimento"]?.visibilidade).toBe("visible");
    expect(camadas["uso-lote-wms"]?.visibilidade).toBe("none");
  });

  it("o WMS pede as 12 camadas regionais num só pedido", () => {
    expect(URL_TILES_USO_LOTE).toContain("vw_UsoPorLoteSER1,");
    expect(URL_TILES_USO_LOTE).toContain("vw_UsoPorLoteSER12");
    expect(URL_TILES_USO_LOTE).toContain("{bbox-epsg-3857}");
  });

  it("a cor da zona vem do tipo da sigla, e a zona de orla não se confunde com ZOP", () => {
    expect(corDaMacrozona("ZOP 1")).toBe(corDaMacrozona("ZOP 2"));
    expect(corDaMacrozona("ZO")).not.toBe(corDaMacrozona("ZOP 1"));
    expect(corDaMacrozona("ZRU 2")).not.toBe(corDaMacrozona("ZOM 1"));
    expect(corDaMacrozona("")).toBe("#6b7280");
  });
});
