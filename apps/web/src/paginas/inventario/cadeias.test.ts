import type { InspecaoResumo, Ocorrencia } from "@itree/api-client";
import { describe, expect, it } from "vitest";

import { montarCadeias } from "./cadeias";

const inspecao = (id: string, codigo: string, realizada_em: string) =>
  ({ id, codigo, realizada_em, estado: "validada" }) as unknown as InspecaoResumo;

const ocorrencia = (
  id: string,
  codigo: string,
  criado_em: string,
  origem: { id: string; codigo: string } | null,
) =>
  ({
    id,
    codigo,
    criado_em,
    origem_vinculo: origem && { tipo: "inspecao", ...origem },
    tarefas: [],
  }) as unknown as Ocorrencia;

describe("montarCadeias", () => {
  it("põe a ocorrência na cadeia da inspeção que a gerou, da mais recente para a mais antiga", () => {
    const cadeias = montarCadeias(
      [
        inspecao("i-1", "INS-000001", "2026-09-01T12:00:00Z"),
        inspecao("i-2", "INS-000002", "2026-10-01T12:00:00Z"),
      ],
      [
        ocorrencia("o-1", "OCO-000001", "2026-09-02T12:00:00Z", {
          id: "i-1",
          codigo: "INS-000001",
        }),
      ],
    );
    expect(cadeias.map((c) => c.inspecao?.codigo)).toEqual(["INS-000002", "INS-000001"]);
    expect(cadeias[0]!.ocorrencias).toEqual([]);
    expect(cadeias[1]!.ocorrencias.map((o) => o.codigo)).toEqual(["OCO-000001"]);
  });

  it("ocorrência sem inspeção de origem forma a própria cadeia, na ordem do tempo", () => {
    const cadeias = montarCadeias(
      [inspecao("i-1", "INS-000001", "2026-09-01T12:00:00Z")],
      [ocorrencia("o-9", "OCO-000009", "2026-10-15T12:00:00Z", null)],
    );
    expect(cadeias.map((c) => c.inspecao?.codigo ?? c.ocorrencias[0]!.codigo)).toEqual([
      "OCO-000009",
      "INS-000001",
    ]);
    expect(cadeias[0]!.inspecao).toBeNull();
  });

  it("mantém a cadeia quando a inspeção de origem não está na lista, usando o vínculo", () => {
    const cadeias = montarCadeias(
      [],
      [
        ocorrencia("o-1", "OCO-000001", "2026-09-02T12:00:00Z", {
          id: "i-7",
          codigo: "INS-000007",
        }),
        ocorrencia("o-2", "OCO-000002", "2026-09-03T12:00:00Z", {
          id: "i-7",
          codigo: "INS-000007",
        }),
      ],
    );
    expect(cadeias).toHaveLength(1);
    expect(cadeias[0]!.inspecao).toEqual({ id: "i-7", codigo: "INS-000007" });
    expect(cadeias[0]!.ocorrencias.map((o) => o.codigo)).toEqual(["OCO-000001", "OCO-000002"]);
  });
});
