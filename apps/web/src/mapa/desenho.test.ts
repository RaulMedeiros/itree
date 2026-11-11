import { describe, expect, it, vi } from "vitest";

import { MapaFalso } from "../testes/mapaFalso";
import {
  adicionarCamadasArea,
  definirArea,
  iniciarDesenho,
  poligonoDeLimites,
  poligonoDeVertices,
  type PoligonoGeoJson,
} from "./desenho";

const evento = (lng: number, lat: number, x: number, y: number) => ({
  lngLat: { lng, lat },
  point: { x, y },
  originalEvent: { button: 0 },
  preventDefault: vi.fn(),
});

function preparar(forma: "retangulo" | "poligono") {
  const mapa = new MapaFalso();
  adicionarCamadasArea(mapa as never);
  const aoConcluir = vi.fn<(a: PoligonoGeoJson) => void>();
  const aoCancelar = vi.fn();
  const encerrar = iniciarDesenho(mapa as never, forma, { aoConcluir, aoCancelar });
  return { mapa, aoConcluir, aoCancelar, encerrar };
}

describe("geometrias da área", () => {
  it("retângulo dos limites é um anel fechado", () => {
    const g = poligonoDeLimites([-38.6, -3.8, -38.5, -3.7]);
    expect(g.coordinates[0]).toHaveLength(5);
    expect(g.coordinates[0]![0]).toEqual(g.coordinates[0]![4]);
  });

  it("polígono exige três vértices", () => {
    expect(
      poligonoDeVertices([
        [0, 0],
        [1, 1],
      ]),
    ).toBeNull();
    expect(
      poligonoDeVertices([
        [0, 0],
        [1, 0],
        [1, 1],
      ])?.coordinates[0],
    ).toHaveLength(4);
  });
});

describe("retângulo por arrasto", () => {
  it("desenha o rascunho ao arrastar e conclui ao soltar", () => {
    const { mapa, aoConcluir, encerrar } = preparar("retangulo");
    expect(mapa.dragPan.disable).toHaveBeenCalled();
    expect(mapa.canvas.style.cursor).toBe("crosshair");

    mapa.emitir("mousedown", evento(-38.56, -3.76, 10, 10));
    mapa.emitir("mousemove", evento(-38.55, -3.75, 60, 60));
    expect(mapa.dadosDe("area-rascunho").features).toHaveLength(1);
    mapa.emitir("mouseup", evento(-38.55, -3.75, 60, 60));

    expect(aoConcluir).toHaveBeenCalledOnce();
    expect(aoConcluir.mock.calls[0]![0].coordinates[0]).toEqual([
      [-38.56, -3.76],
      [-38.55, -3.76],
      [-38.55, -3.75],
      [-38.56, -3.75],
      [-38.56, -3.76],
    ]);
    expect(mapa.dadosDe("area-rascunho").features).toEqual([]);

    encerrar();
    expect(mapa.dragPan.enable).toHaveBeenCalled();
    expect(mapa.doubleClickZoom.enable).toHaveBeenCalled();
    expect(mapa.canvas.style.cursor).toBe("");
    expect(mapa.manipuladores).toEqual([]);
  });

  it("um clique sem arrastar não cria área", () => {
    const { mapa, aoConcluir } = preparar("retangulo");
    mapa.emitir("mousedown", evento(-38.56, -3.76, 10, 10));
    mapa.emitir("mouseup", evento(-38.56, -3.76, 11, 11));
    expect(aoConcluir).not.toHaveBeenCalled();
  });
});

describe("polígono por cliques", () => {
  it("fecha no duplo clique, sem repetir o último vértice", () => {
    const { mapa, aoConcluir } = preparar("poligono");
    mapa.emitir("click", evento(-38.56, -3.76, 10, 10));
    mapa.emitir("click", evento(-38.55, -3.76, 60, 10));
    mapa.emitir("mousemove", evento(-38.55, -3.75, 60, 60));
    // Rascunho: polígono com o cursor e os dois vértices.
    expect(mapa.dadosDe("area-rascunho").features).toHaveLength(3);
    // Duplo clique = dois cliques no mesmo ponto e o dblclick.
    mapa.emitir("click", evento(-38.55, -3.75, 60, 60));
    mapa.emitir("click", evento(-38.55, -3.75, 61, 60));
    const dbl = evento(-38.55, -3.75, 61, 60);
    mapa.emitir("dblclick", dbl);

    expect(dbl.preventDefault).toHaveBeenCalled();
    expect(aoConcluir).toHaveBeenCalledOnce();
    expect(aoConcluir.mock.calls[0]![0].coordinates[0]).toEqual([
      [-38.56, -3.76],
      [-38.55, -3.76],
      [-38.55, -3.75],
      [-38.56, -3.76],
    ]);
  });

  it("não fecha com menos de três vértices; Backspace desfaz; Enter fecha", () => {
    const { mapa, aoConcluir } = preparar("poligono");
    mapa.emitir("click", evento(-38.56, -3.76, 10, 10));
    mapa.emitir("click", evento(-38.55, -3.76, 60, 10));
    mapa.emitir("dblclick", evento(-38.55, -3.76, 60, 10));
    expect(aoConcluir).not.toHaveBeenCalled();

    mapa.emitir("click", evento(-38.55, -3.75, 60, 60));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(aoConcluir).not.toHaveBeenCalled(); // voltou a dois vértices

    mapa.emitir("click", evento(-38.55, -3.75, 60, 60));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(aoConcluir).toHaveBeenCalledOnce();
  });
});

describe("cancelamento", () => {
  it("Esc cancela e, ao encerrar, o teclado deixa de ser ouvido", () => {
    const { aoCancelar, encerrar } = preparar("poligono");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(aoCancelar).toHaveBeenCalledOnce();
    encerrar();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(aoCancelar).toHaveBeenCalledOnce();
  });
});

describe("área concluída", () => {
  it("fica na fonte da área, com contorno tracejado, e sai com null", () => {
    const mapa = new MapaFalso();
    adicionarCamadasArea(mapa as never, "selecao");
    expect(mapa.camadas.find((c) => c.id === "area-selecao-contorno")?.antesDe).toBe("selecao");
    definirArea(mapa as never, poligonoDeLimites([0, 0, 1, 1]));
    expect(mapa.dadosDe("area-selecao").features).toHaveLength(1);
    definirArea(mapa as never, null);
    expect(mapa.dadosDe("area-selecao").features).toEqual([]);
  });
});
