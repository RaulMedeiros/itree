import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "../util/cn";

/** Papel da coluna quando a tabela vira lista de cartões (abaixo de `md`). */
export type PapelNoCartao = "oculta";

/**
 * Tabela com rolagem horizontal quando não cabe. Uma sombra na borda direita
 * avisa que há colunas escondidas; sem ela, a tabela cortada parece defeito (R3-10).
 *
 * Abaixo de `md` (celular) cada linha vira um **cartão** (regras em `estilos.css`, classe
 * `tabela-cartoes`): a primeira coluna com cabeçalho é o título do cartão, as demais mostram o
 * rótulo da coluna ao lado do valor, a coluna sem cabeçalho (ação) fica no fim e as colunas
 * marcadas com `<Th cartao="oculta">` somem. Os rótulos vão para as células como `data-rotulo`.
 */
export function Tabela({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  const area = useRef<HTMLDivElement>(null);
  const tabela = useRef<HTMLTableElement>(null);
  const [maisADireita, setMaisADireita] = useState(false);
  const [barra, setBarra] = useState<InfoBarra | null>(null);

  const medir = useCallback(() => {
    const el = area.current;
    if (!el) return;
    setMaisADireita(el.scrollWidth - el.scrollLeft - el.clientWidth > 4);
  }, []);

  // Só troca o estado quando a leitura mudou, para a renderização a cada efeito não virar laço.
  const atualizarBarra = useCallback((nova: InfoBarra | null) => {
    setBarra((atual) => (JSON.stringify(atual) === JSON.stringify(nova) ? atual : nova));
  }, []);

  // Copia o cabeçalho de cada coluna para as células, que o CSS do cartão usa como rótulo.
  // Roda a cada renderização: trocar de página ou de filtro troca as linhas.
  useLayoutEffect(() => {
    if (!tabela.current) return;
    rotularCelulas(tabela.current);
    atualizarBarra(lerBarra(tabela.current));
  });

  useEffect(() => {
    medir();
    const el = area.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    if (el.firstElementChild) observador.observe(el.firstElementChild);
    return () => observador.disconnect();
  }, [medir]);

  return (
    <div className="relative rounded-lg border border-borda bg-superficie">
      {barra && <BarraDoCartao info={barra} tabela={tabela} />}
      <div ref={area} onScroll={medir} className="overflow-x-auto rounded-lg">
        <table
          ref={tabela}
          className={cn("tabela-cartoes w-full border-collapse text-sm", className)}
          {...props}
        />
      </div>
      {maisADireita && (
        <div
          data-testid="mais-colunas"
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-6 rounded-r-lg bg-gradient-to-l from-texto/15 to-transparent"
        />
      )}
    </div>
  );
}

interface InfoBarra {
  /** Caixa "selecionar todos" do cabeçalho, se a tabela tiver uma. */
  selecao: { checked: boolean; indeterminate: boolean; disabled: boolean; linhas: number } | null;
  /** Colunas ordenáveis, na ordem do cabeçalho. */
  colunas: { rotulo: string; direcao: "asc" | "desc" | null }[];
}

const SELETOR_ORDENAVEIS = "thead th[aria-sort] button";

/** Lê do cabeçalho o que a barra do cartão precisa: a caixa de seleção e as colunas ordenáveis. */
function lerBarra(tabela: HTMLTableElement): InfoBarra | null {
  const caixa = tabela.querySelector<HTMLInputElement>('thead th input[type="checkbox"]');
  const colunas = Array.from(tabela.querySelectorAll<HTMLElement>(SELETOR_ORDENAVEIS)).map((b) => {
    const sort = b.closest("th")?.getAttribute("aria-sort");
    return {
      rotulo: (b.textContent ?? "").trim(),
      direcao:
        sort === "ascending" ? ("asc" as const) : sort === "descending" ? ("desc" as const) : null,
    };
  });
  if (!caixa && colunas.length === 0) return null;
  return {
    selecao: caixa
      ? {
          checked: caixa.checked,
          indeterminate: caixa.indeterminate,
          disabled: caixa.disabled,
          linhas: tabela.querySelectorAll("tbody tr").length,
        }
      : null,
    colunas,
  };
}

/**
 * Barra compacta acima dos cartões (só abaixo de `md`): no celular o cabeçalho fica oculto e com
 * ele somem o "selecionar todos" e a ordenação por coluna. A barra repete os dois e age sobre os
 * controles do próprio cabeçalho, de modo que a página não precisa saber dela.
 */
function BarraDoCartao({
  info,
  tabela,
}: {
  info: InfoBarra;
  tabela: React.RefObject<HTMLTableElement | null>;
}) {
  const ordenaveis = () =>
    Array.from(tabela.current?.querySelectorAll<HTMLElement>(SELETOR_ORDENAVEIS) ?? []);
  const atual = info.colunas.findIndex((c) => c.direcao);
  const direcao = atual >= 0 ? info.colunas[atual]!.direcao : null;
  return (
    <div
      data-testid="barra-cartoes"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-t-lg border-b border-borda bg-fundo px-3 py-1 md:hidden"
    >
      {info.selecao && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-marca"
            checked={info.selecao.checked}
            disabled={info.selecao.disabled}
            ref={(el) => {
              if (el) el.indeterminate = info.selecao!.indeterminate;
            }}
            onChange={() =>
              tabela.current
                ?.querySelector<HTMLInputElement>('thead th input[type="checkbox"]')
                ?.click()
            }
          />
          Selecionar todos ({info.selecao.linhas})
        </label>
      )}
      {info.colunas.length > 0 && (
        <div className="flex items-center gap-1 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-texto-suave">Ordenar por</span>
            <select
              className="seletor h-11 rounded-md border border-borda bg-superficie py-1 pr-8 pl-2 text-sm"
              value={atual >= 0 ? String(atual) : ""}
              onChange={(e) => ordenaveis()[Number(e.target.value)]?.click()}
            >
              {atual < 0 && (
                <option value="" disabled>
                  Escolha
                </option>
              )}
              {info.colunas.map((c, n) => (
                <option key={c.rotulo} value={n}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </label>
          {atual >= 0 && (
            <button
              type="button"
              aria-label={`Ordem ${direcao === "asc" ? "crescente" : "decrescente"}; tocar para inverter`}
              onClick={() => ordenaveis()[atual]?.click()}
              className="inline-flex size-11 items-center justify-center rounded-md border border-borda bg-superficie"
            >
              {direcao === "asc" ? (
                <ArrowUp className="size-4" aria-hidden />
              ) : (
                <ArrowDown className="size-4" aria-hidden />
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function rotularCelulas(tabela: HTMLTableElement) {
  const cabecalhos = Array.from(tabela.querySelectorAll<HTMLElement>("thead th"));
  const rotulos = cabecalhos.map((th) => (th.textContent ?? "").trim());
  const titulo = rotulos.findIndex((r) => r !== "");
  for (const linha of Array.from(tabela.querySelectorAll("tbody tr"))) {
    Array.from(linha.children).forEach((celula, n) => {
      if (
        !(celula instanceof HTMLTableCellElement) ||
        celula.tagName !== "TD" ||
        celula.colSpan > 1
      )
        return;
      const rotulo = rotulos[n] ?? "";
      const alterar = (nome: string, valor: string | null) =>
        valor === null ? celula.removeAttribute(nome) : celula.setAttribute(nome, valor);
      alterar("data-titulo", n === titulo ? "" : null);
      alterar("data-rotulo", n !== titulo && rotulo ? rotulo : null);
      alterar("data-oculta", cabecalhos[n]?.dataset.cartao === "oculta" ? "" : null);
    });
  }
}

/**
 * Cabeçalho de coluna: o rótulo não quebra em várias linhas. Para um rótulo longo,
 * passe o curto como conteúdo e o completo em `dica` (aparece ao pousar o cursor).
 */
export function Th({
  className,
  dica,
  cartao,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { dica?: string; cartao?: PapelNoCartao }) {
  return (
    <th
      scope="col"
      title={dica}
      data-cartao={cartao}
      className={cn(
        "border-b border-borda bg-fundo px-3 py-2 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-texto-suave uppercase",
        className,
      )}
      {...props}
    />
  );
}

/** `semQuebra` mantém nomes de pessoa e de bairro numa linha só. */
export function Td({
  className,
  semQuebra,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { semQuebra?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-borda px-3 py-2.5 align-top",
        semQuebra && "whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

export function Linha({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("last:[&>td]:border-b-0", className)} {...props} />;
}

/** Cabeçalho clicável: `direcao` indica a ordenação atual desta coluna (undefined = não ordenada). */
export function ThOrdenavel({
  children,
  direcao,
  aoOrdenar,
  className,
  dica,
  cartao,
}: {
  children: string;
  dica?: string;
  cartao?: PapelNoCartao;
  direcao?: "asc" | "desc";
  aoOrdenar: () => void;
  className?: string;
}) {
  const Icone = direcao === "asc" ? ArrowUp : direcao === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <Th
      className={className}
      dica={dica}
      cartao={cartao}
      aria-sort={direcao === "asc" ? "ascending" : direcao === "desc" ? "descending" : "none"}
    >
      <button
        type="button"
        onClick={aoOrdenar}
        className="inline-flex items-center gap-1 font-semibold tracking-wide uppercase hover:text-texto"
      >
        {children}
        <Icone className={cn("size-3.5", !direcao && "opacity-50")} aria-hidden />
      </button>
    </Th>
  );
}
