import type { ReactNode } from "react";

import { cn } from "../../util/cn";

/**
 * Classes da tabela "Comparação" da revisão. No desktop é uma tabela de três (ou quatro) colunas.
 * Abaixo de `md` ela não cabe: cada campo vira um bloco, com as colunas empilhadas e rotuladas
 * (o rótulo vem de `data-rotulo`) e o cabeçalho escondido.
 */
export function TabelaComparacao({
  cabecalho,
  children,
}: {
  cabecalho: ReactNode;
  children: ReactNode;
}) {
  return (
    <table className="w-full max-md:block">
      <thead className="max-md:sr-only">{cabecalho}</thead>
      <tbody className="max-md:block">{children}</tbody>
    </table>
  );
}

const ROTULO =
  "max-md:before:mb-0.5 max-md:before:block max-md:before:text-[11px] max-md:before:font-semibold max-md:before:tracking-wide max-md:before:text-texto-suave max-md:before:uppercase max-md:before:content-[attr(data-rotulo)]";

/** Uma linha da comparação; `destaque` marca o que a inspeção muda em relação ao cadastro. */
export function LinhaComparacao({
  campo,
  inspecao,
  cadastro,
  anterior,
  destaque,
}: {
  campo: string;
  inspecao: ReactNode;
  cadastro: ReactNode;
  anterior?: ReactNode;
  destaque?: boolean;
}) {
  return (
    <tr
      data-mudou={destaque ? "" : undefined}
      className={cn(
        "border-t border-borda align-top",
        "max-md:mb-3 max-md:block max-md:rounded-md max-md:border max-md:p-3",
        destaque && "max-md:border-marca max-md:bg-marca-clara",
      )}
    >
      <th
        scope="row"
        className="py-2 pr-4 text-left text-sm font-medium max-md:flex max-md:items-center max-md:justify-between max-md:gap-2 max-md:p-0 max-md:pb-1 max-md:text-base"
      >
        {campo}
        {destaque && (
          <span className="hidden rounded-full bg-marca px-2 py-0.5 text-xs font-medium text-white max-md:inline">
            Mudou
          </span>
        )}
      </th>
      <td
        data-rotulo="Esta inspeção"
        className={cn(
          "py-2 pr-4 text-sm max-md:block max-md:p-0 max-md:py-1",
          ROTULO,
          destaque && "font-medium text-marca-escura",
        )}
      >
        {inspecao}
      </td>
      <td
        data-rotulo="Cadastro atual"
        className={cn("py-2 pr-4 text-sm max-md:block max-md:p-0 max-md:py-1", ROTULO)}
      >
        {cadastro}
      </td>
      {anterior !== undefined && (
        <td
          data-rotulo="Inspeção anterior"
          className={cn(
            "py-2 text-sm text-texto-suave max-md:block max-md:p-0 max-md:py-1",
            ROTULO,
          )}
        >
          {anterior}
        </td>
      )}
    </tr>
  );
}
