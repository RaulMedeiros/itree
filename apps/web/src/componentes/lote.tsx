import type { ResultadoAcaoEmLote } from "@itree/api-client";
import type { ReactNode } from "react";

import { Botao } from "../ui/botao";
import { Dialogo } from "../ui/dialogo";
import { plural } from "../util/formatos";
import { LIMITE_ACOES_EM_LOTE } from "../util/lote";

/** Faixa com a contagem da seleção e as ações em lote, que o chamador filtra por permissão. */
export function BarraAcoesEmLote({
  total,
  singular,
  plural: pluralForma,
  aoLimpar,
  children,
}: {
  total: number;
  /** "ocorrência selecionada" */
  singular: string;
  /** "ocorrências selecionadas" */
  plural: string;
  aoLimpar: () => void;
  children: ReactNode;
}) {
  if (total === 0) return null;
  const excede = total > LIMITE_ACOES_EM_LOTE;
  return (
    <div
      role="region"
      aria-label="Ações da seleção"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-marca bg-marca-clara px-3 py-2"
    >
      <p role="status" className="mr-2 text-sm font-medium">
        {plural(total, singular, pluralForma)}
      </p>
      {children}
      <Botao variante="fantasma" onClick={aoLimpar}>
        Limpar seleção
      </Botao>
      {excede && (
        <p role="alert" className="basis-full text-xs text-perigo">
          O limite é de {LIMITE_ACOES_EM_LOTE} registros por ação. Desmarque{" "}
          {total - LIMITE_ACOES_EM_LOTE} para continuar.
        </p>
      )}
    </div>
  );
}

/** Resultado de uma ação em lote: quantos mudaram e, de cada um que não mudou, o motivo. */
export function ResultadoDoLote({
  resultado,
  aoFechar,
  titulo,
}: {
  resultado: ResultadoAcaoEmLote;
  aoFechar: () => void;
  titulo: string;
}) {
  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      titulo={titulo}
      rodape={<Botao onClick={aoFechar}>Fechar</Botao>}
    >
      <p role="status" className="text-sm">
        <strong>{resultado.atualizadas}</strong>{" "}
        {resultado.atualizadas === 1 ? "registro alterado" : "registros alterados"}.
      </p>
      {resultado.ignoradas.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium">
            {plural(
              resultado.ignoradas.length,
              "registro não foi alterado",
              "registros não foram alterados",
            )}
          </p>
          <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5 text-sm text-texto-suave">
            {resultado.ignoradas.map((i) => (
              <li key={i.id}>
                {i.codigo && <span className="font-mono">{i.codigo}: </span>}
                {i.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialogo>
  );
}

/** Checkbox de cabeçalho: marca a página inteira (indeterminado quando só parte está marcada). */
export function CaixaDaPagina({
  rotulo,
  inteira,
  parcial,
  aoAlternar,
}: {
  rotulo: string;
  inteira: boolean;
  parcial: boolean;
  aoAlternar: (marcado: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      aria-label={rotulo}
      className="size-4 accent-marca"
      checked={inteira}
      ref={(el) => {
        if (el) el.indeterminate = parcial;
      }}
      onChange={(e) => aoAlternar(e.target.checked)}
    />
  );
}
