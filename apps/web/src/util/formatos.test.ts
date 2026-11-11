import { describe, expect, it } from "vitest";

import {
  contar,
  descreverAreaVerdeProxima,
  descreverPrazo,
  diasDesde,
  prazoRestante,
} from "./formatos";

const agora = new Date("2026-11-10T15:00:00Z"); // 10/11 12h em Fortaleza

describe("formatos", () => {
  it("conta com singular e plural", () => {
    expect(contar(1, "sinal", "sinais")).toBe("1 sinal");
    expect(contar(3, "sinal", "sinais")).toBe("3 sinais");
  });

  it("descreve o prazo restante e o atraso", () => {
    expect(prazoRestante("2026-11-13", agora)).toEqual({
      texto: "vence em 3 dias",
      atrasado: false,
    });
    expect(prazoRestante("2026-11-11", agora)?.texto).toBe("vence amanhã");
    expect(prazoRestante("2026-11-10", agora)?.texto).toBe("vence hoje");
    expect(prazoRestante("2026-11-09", agora)).toEqual({
      texto: "atrasado há 1 dia",
      atrasado: true,
    });
    expect(prazoRestante("2026-11-05", agora)?.texto).toBe("atrasado há 5 dias");
    expect(prazoRestante(null, agora)).toBeNull();
  });

  it("conta dias corridos pelo calendário de Fortaleza", () => {
    expect(diasDesde("2026-11-07T20:00:00Z", agora)).toBe(3);
    expect(diasDesde("2026-11-10T02:00:00Z", agora)).toBe(1); // 09/11 23h em Fortaleza
  });
});

describe("descreverPrazo", () => {
  const hoje = new Date("2026-11-11T15:00:00Z");
  it("conta os dias restantes e o atraso", () => {
    expect(descreverPrazo("2026-11-30", hoje)).toBe("faltam 19 dias");
    expect(descreverPrazo("2026-11-12", hoje)).toBe("falta 1 dia");
    expect(descreverPrazo("2026-11-11", hoje)).toBe("vence hoje");
    expect(descreverPrazo("2026-11-08", hoje)).toBe("atrasado há 3 dias");
  });

  it("descreve a área verde próxima ao foco, com a distância em km", () => {
    const parque = { nome: "Parque Estadual do Cocó", tipo: "parque", distancia_m: 611 };
    expect(descreverAreaVerdeProxima(parque)).toBe("a 0,6 km do Parque Estadual do Cocó");
    expect(descreverAreaVerdeProxima({ ...parque, distancia_m: 1000 })).toBe(
      "a 1,0 km do Parque Estadual do Cocó",
    );
    expect(descreverAreaVerdeProxima({ ...parque, distancia_m: 40 })).toBe(
      "a 40 m do Parque Estadual do Cocó",
    );
    expect(descreverAreaVerdeProxima({ ...parque, distancia_m: 0 })).toBe(
      "dentro de Parque Estadual do Cocó",
    );
    expect(descreverAreaVerdeProxima({ nome: "APA do Rio Ceará", distancia_m: 800 })).toBe(
      "a 0,8 km da APA do Rio Ceará",
    );
    expect(descreverAreaVerdeProxima(null)).toBeNull();
    expect(descreverAreaVerdeProxima(undefined)).toBeNull();
  });
});
