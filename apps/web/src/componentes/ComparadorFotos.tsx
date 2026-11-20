import type { FotoArvore } from "@itree/api-client";
import { useState } from "react";

import { Selecao } from "../ui/campos";
import { cn } from "../util/cn";
import { formatarData } from "../util/formatos";
import { altDaFoto, rotuloOrigem } from "./galeriaArvore";

type Modo = "lado" | "deslizante";

const urlGrande = (f: FotoArvore) => f.url ?? f.url_miniatura ?? undefined;
const rotuloOpcao = (f: FotoArvore) => `${formatarData(f.data)} · ${rotuloOrigem(f)}`;

/**
 * Compara duas fotos da árvore: lado a lado, ou com uma barra deslizante que revela a de
 * "antes" sobre a de "depois". Começa com a mais antiga contra a mais recente.
 */
export function ComparadorFotos({
  fotos,
  codigoArvore,
}: {
  fotos: readonly FotoArvore[];
  codigoArvore: string;
}) {
  const [modo, setModo] = useState<Modo>("lado");
  const [antesId, setAntesId] = useState(fotos[0]!.id);
  const [depoisId, setDepoisId] = useState(fotos[fotos.length - 1]!.id);
  const [posicao, setPosicao] = useState(50);
  const antes = fotos.find((f) => f.id === antesId) ?? fotos[0]!;
  const depois = fotos.find((f) => f.id === depoisId) ?? fotos[fotos.length - 1]!;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Foto de antes</span>
          <Selecao value={antesId} onChange={(e) => setAntesId(e.target.value)}>
            {fotos.map((f) => (
              <option key={f.id} value={f.id}>
                {rotuloOpcao(f)}
              </option>
            ))}
          </Selecao>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Foto de depois</span>
          <Selecao value={depoisId} onChange={(e) => setDepoisId(e.target.value)}>
            {fotos.map((f) => (
              <option key={f.id} value={f.id}>
                {rotuloOpcao(f)}
              </option>
            ))}
          </Selecao>
        </label>
      </div>
      <div role="group" aria-label="Modo de comparação" className="flex gap-2">
        {(
          [
            ["lado", "Lado a lado"],
            ["deslizante", "Barra deslizante"],
          ] as const
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            aria-pressed={modo === valor}
            onClick={() => setModo(valor)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              modo === valor
                ? "border-marca bg-marca-clara font-medium text-marca-escura"
                : "border-borda hover:bg-neutro-clara",
            )}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {modo === "lado" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Lado rotulo="Antes" foto={antes} codigoArvore={codigoArvore} />
          <Lado rotulo="Depois" foto={depois} codigoArvore={codigoArvore} />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-fundo select-none">
            <img
              src={urlGrande(depois)}
              alt={`Depois: ${altDaFoto(depois, codigoArvore)}`}
              className="absolute inset-0 size-full object-cover"
              draggable={false}
            />
            <img
              src={urlGrande(antes)}
              alt={`Antes: ${altDaFoto(antes, codigoArvore)}`}
              className="absolute inset-0 size-full object-cover"
              style={{ clipPath: `inset(0 ${100 - posicao}% 0 0)` }}
              draggable={false}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{ left: `${posicao}%` }}
            />
            <span className="absolute top-2 left-2 rounded bg-black/65 px-2 py-0.5 text-xs text-white">
              Antes · {formatarData(antes.data)}
            </span>
            <span className="absolute top-2 right-2 rounded bg-black/65 px-2 py-0.5 text-xs text-white">
              Depois · {formatarData(depois.data)}
            </span>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <span className="shrink-0">Posição da divisória</span>
            <input
              type="range"
              min={0}
              max={100}
              value={posicao}
              onChange={(e) => setPosicao(Number(e.target.value))}
              aria-valuetext={`${posicao}% da foto de antes visível`}
              className="w-full accent-marca"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function Lado({
  rotulo,
  foto,
  codigoArvore,
}: {
  rotulo: string;
  foto: FotoArvore;
  codigoArvore: string;
}) {
  return (
    <figure className="overflow-hidden rounded-lg border border-borda">
      <img
        src={urlGrande(foto)}
        alt={`${rotulo}: ${altDaFoto(foto, codigoArvore)}`}
        className="aspect-[4/3] w-full object-cover"
      />
      <figcaption className="px-3 py-1.5 text-sm">
        <span className="font-medium">{rotulo}</span> · {formatarData(foto.data)}
        <span className="block text-xs text-texto-suave">{rotuloOrigem(foto)}</span>
      </figcaption>
    </figure>
  );
}
