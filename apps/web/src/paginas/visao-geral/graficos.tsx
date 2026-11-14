/**
 * Gráficos da visão geral, em SVG/HTML simples (sem biblioteca), seguindo as
 * especificações de marcas da skill de visualização: linhas de 2 px, pontos
 * de 8 px com anel da superfície, grade fina, legenda para ≥ 2 séries, rótulo
 * só no fim da linha, tooltip com cruz e tabela equivalente.
 */
import { useId, useState, type ReactNode } from "react";

import { formatarDataCurta } from "../../util/formatos";

/** Paleta categórica validada (azul, laranja): passa nos testes de daltonismo. */
const CORES_SERIES = ["#2a78d6", "#eb6834"];

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function rotuloMes(m: string) {
  const [ano, mes] = m.split("-").map(Number);
  return `${MESES[(mes ?? 1) - 1]}/${String(ano).slice(2)}`;
}

function teto(maximo: number) {
  if (maximo <= 5) return 5;
  const passo = 10 ** Math.floor(Math.log10(maximo));
  return Math.ceil(maximo / passo) * passo;
}

export interface Serie {
  id: string;
  rotulo: string;
  /** Um valor por mês; `null` é mês sem dado na fonte (não é zero). */
  valores: (number | null)[];
}

/** Rótulo do mês que a fonte não publicou, no gráfico, na dica e na tabela. */
export const ROTULO_SEM_DADO = "sem dado na fonte";

export function GraficoMensal({
  meses,
  series,
  semDado = [],
  parcial = null,
}: {
  meses: string[];
  series: Serie[];
  /** Meses (AAAA-MM) que a fonte não publicou: a linha se interrompe e a faixa é marcada. */
  semDado?: string[];
  /** Mês (AAAA-MM) em andamento: o último ponto é vazado e o rótulo diz "(parcial)". */
  parcial?: string | null;
}) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);
  const idTabela = useId();
  const idHachura = `hachura-${idTabela.replace(/[^a-zA-Z0-9]/g, "")}`;
  const L = 640;
  const A = 220;
  const m = { esq: 36, dir: 96, topo: 12, base: 28 };
  const largura = L - m.esq - m.dir;
  const altura = A - m.topo - m.base;
  const maximo = teto(
    Math.max(1, ...series.flatMap((s) => s.valores.filter((v): v is number => v !== null))),
  );
  const faltam = new Set(semDado);
  const passo = largura / Math.max(1, meses.length - 1);
  const x = (i: number) => m.esq + (largura * i) / Math.max(1, meses.length - 1);
  const y = (v: number) => m.topo + altura - (altura * v) / maximo;
  const marcas = [0, maximo / 2, maximo];

  return (
    <div>
      <ul
        className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-suave"
        aria-label="Legenda"
      >
        {series.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4 rounded"
              style={{ background: CORES_SERIES[i] }}
            />
            {s.rotulo}
          </li>
        ))}
      </ul>
      <div className="relative">
        <svg
          viewBox={`0 0 ${L} ${A}`}
          className="w-full"
          role="img"
          aria-label={`Evolução mensal: ${series.map((s) => s.rotulo).join(" e ")}, de ${rotuloMes(meses[0] ?? "")} a ${rotuloMes(meses[meses.length - 1] ?? "")}. Valores na tabela.`}
          onMouseLeave={() => setAtivo(null)}
        >
          <defs>
            <pattern
              id={idHachura}
              width={6}
              height={6}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1={0} y1={0} x2={0} y2={6} stroke="#9aa59f" strokeWidth={1.5} opacity={0.45} />
            </pattern>
          </defs>
          {marcas.map((v) => (
            <g key={v}>
              <line
                x1={m.esq}
                x2={m.esq + largura}
                y1={y(v)}
                y2={y(v)}
                stroke="#e4e7e2"
                strokeWidth={1}
              />
              <text
                x={m.esq - 6}
                y={y(v) + 4}
                textAnchor="end"
                className="fill-texto-suave text-[10px] tabular-nums"
              >
                {v.toLocaleString("pt-BR")}
              </text>
            </g>
          ))}
          {meses.map((mes, i) =>
            i % 2 === meses.length % 2 ? null : (
              <text
                key={mes}
                x={x(i)}
                y={A - 8}
                textAnchor="middle"
                className="fill-texto-suave text-[10px]"
              >
                {rotuloMes(mes)}
                {mes === parcial ? " (parcial)" : ""}
              </text>
            ),
          )}
          {meses.map((mes, i) =>
            faltam.has(mes) ? (
              <g key={`sem-${mes}`} data-testid={`sem-dado-${mes}`}>
                <rect
                  x={x(i) - passo / 2}
                  y={m.topo}
                  width={passo}
                  height={altura}
                  fill={`url(#${idHachura})`}
                />
                <text
                  x={x(i)}
                  y={m.topo + 12}
                  textAnchor="middle"
                  className="fill-texto-suave text-[9px]"
                >
                  <tspan x={x(i)}>sem dado</tspan>
                  <tspan x={x(i)} dy={11}>
                    na fonte
                  </tspan>
                </text>
              </g>
            ) : null,
          )}
          {ativo !== null && (
            <line
              x1={x(ativo)}
              x2={x(ativo)}
              y1={m.topo}
              y2={m.topo + altura}
              stroke="#9aa59f"
              strokeWidth={1}
            />
          )}
          {series.map((s, i) => {
            const cor = CORES_SERIES[i]!;
            // A linha se interrompe nos meses sem dado: nunca liga um mês ao outro por cima do vazio.
            const trechos: string[][] = [[]];
            s.valores.forEach((v, j) => {
              if (v === null) trechos.push([]);
              else trechos[trechos.length - 1]!.push(`${x(j)},${y(v)}`);
            });
            const ultimo = s.valores.findLastIndex((v) => v !== null);
            const valorAtivo = ativo !== null ? s.valores[ativo] : null;
            return (
              <g key={s.id}>
                {trechos
                  .filter((t) => t.length > 0)
                  .map((t) =>
                    t.length === 1 ? (
                      <circle
                        key={t[0]}
                        cx={Number(t[0]!.split(",")[0])}
                        cy={Number(t[0]!.split(",")[1])}
                        r={2.5}
                        fill={cor}
                      />
                    ) : (
                      <polyline
                        key={t[0]}
                        points={t.join(" ")}
                        fill="none"
                        stroke={cor}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    ),
                  )}
                {ativo !== null && valorAtivo !== null && valorAtivo !== undefined && (
                  <circle
                    cx={x(ativo)}
                    cy={y(valorAtivo)}
                    r={4}
                    fill={cor}
                    stroke="#fff"
                    strokeWidth={2}
                  />
                )}
                {ultimo >= 0 && (
                  <>
                    {meses[ultimo] === parcial ? (
                      <circle
                        data-testid="ponto-parcial"
                        cx={x(ultimo)}
                        cy={y(s.valores[ultimo] ?? 0)}
                        r={4}
                        fill="#fff"
                        stroke={cor}
                        strokeWidth={2}
                      />
                    ) : (
                      <circle
                        cx={x(ultimo)}
                        cy={y(s.valores[ultimo] ?? 0)}
                        r={4}
                        fill={cor}
                        stroke="#fff"
                        strokeWidth={2}
                      />
                    )}
                    {/* Rótulo só no fim da linha; texto em cor de texto, identidade pela marca. */}
                    <text
                      x={x(ultimo) + 8}
                      y={y(s.valores[ultimo] ?? 0) + 4}
                      className="fill-texto text-[11px] font-medium tabular-nums"
                    >
                      {(s.valores[ultimo] ?? 0).toLocaleString("pt-BR")}
                    </text>
                  </>
                )}
              </g>
            );
          })}
          {/* Faixas de toque/foco maiores que as marcas. */}
          {meses.map((mes, i) => (
            <rect
              key={mes}
              x={x(i) - largura / meses.length / 2}
              y={m.topo}
              width={largura / meses.length}
              height={altura}
              fill="transparent"
              tabIndex={0}
              aria-label={`${rotuloMes(mes)}${mes === parcial ? " (parcial)" : ""}: ${faltam.has(mes) ? ROTULO_SEM_DADO : series.map((s) => `${s.rotulo} ${s.valores[i]}`).join(", ")}`}
              onMouseEnter={() => setAtivo(i)}
              onFocus={() => setAtivo(i)}
              onBlur={() => setAtivo(null)}
              className="outline-none focus-visible:fill-marca/10"
            />
          ))}
        </svg>
        {ativo !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-md border border-borda bg-superficie px-2.5 py-1.5 text-xs shadow-md"
            style={{
              left: `${(x(ativo) / L) * 100}%`,
              transform: `translateX(${ativo > meses.length / 2 ? "-110%" : "10%"})`,
            }}
            role="status"
          >
            <p className="mb-0.5 font-semibold">
              {rotuloMes(meses[ativo] ?? "")}
              {meses[ativo] === parcial ? " (parcial)" : ""}
            </p>
            {faltam.has(meses[ativo] ?? "") ? (
              <p className="whitespace-nowrap text-texto-suave">{ROTULO_SEM_DADO}</p>
            ) : (
              series.map((s, i) => (
                <p key={s.id} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ background: CORES_SERIES[i] }}
                  />
                  {s.rotulo}: <span className="font-medium tabular-nums">{s.valores[ativo]}</span>
                </p>
              ))
            )}
          </div>
        )}
      </div>
      <button
        className="mt-1 text-xs text-marca-escura underline"
        aria-expanded={tabela}
        aria-controls={idTabela}
        onClick={() => setTabela((t) => !t)}
      >
        {tabela ? "Ocultar tabela" : "Ver em tabela"}
      </button>
      {tabela && (
        <table id={idTabela} className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-texto-suave">
              <th className="py-1 font-medium">Mês</th>
              {series.map((s) => (
                <th key={s.id} className="py-1 text-right font-medium">
                  {s.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meses.map((mes, i) => (
              <tr key={mes} className="border-t border-borda">
                <td className="py-1">
                  {rotuloMes(mes)}
                  {mes === parcial ? " (parcial)" : ""}
                </td>
                {faltam.has(mes) ? (
                  <td colSpan={series.length} className="py-1 text-right text-texto-suave">
                    {ROTULO_SEM_DADO}
                  </td>
                ) : (
                  series.map((s) => (
                    <td key={s.id} className="py-1 text-right tabular-nums">
                      {s.valores[i]}
                    </td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Barra segmentada alta (um todo dividido em partes), com legenda e valores. */
export function BarraSegmentada({
  partes,
}: {
  partes: {
    rotulo: string;
    quantidade: number;
    cor: string;
    textoClaro?: boolean;
    /** Ação própria da parte (ex.: criar tarefas), mostrada sob o seu item da legenda. */
    acao?: ReactNode;
  }[];
}) {
  const total = partes.reduce((s, p) => s + p.quantidade, 0);
  if (!total) return <p className="text-sm text-texto-suave">Sem árvores válidas.</p>;
  return (
    <div>
      <div
        className="flex h-7 w-full gap-0.5"
        role="img"
        aria-label={partes
          .map((p) => `${p.rotulo}: ${p.quantidade} (${Math.round((100 * p.quantidade) / total)}%)`)
          .join("; ")}
      >
        {partes
          .filter((p) => p.quantidade > 0)
          .map((p) => {
            const pct = (100 * p.quantidade) / total;
            return (
              <div
                key={p.rotulo}
                className="flex items-center rounded px-1.5 text-[11px] font-semibold"
                style={{
                  width: `${pct}%`,
                  background: p.cor,
                  color: p.textoClaro ? "#ffffff" : "#1b2420",
                }}
                title={`${p.rotulo}: ${p.quantidade.toLocaleString("pt-BR")} (${Math.round(pct)}%)`}
              >
                {pct >= 9 ? `${Math.round(pct)}%` : ""}
              </div>
            );
          })}
      </div>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm">
        {partes.map((p) => (
          <li key={p.rotulo}>
            <div className="flex items-center gap-2">
              <span
                className="inline-block size-2.5 shrink-0 rounded-sm"
                style={{ background: p.cor }}
              />
              <span className="flex-1 truncate">{p.rotulo}</span>
              <span className="tabular-nums text-texto-suave">
                {p.quantidade.toLocaleString("pt-BR")}
              </span>
            </div>
            {p.acao && <div className="mt-1 pl-[18px]">{p.acao}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barras horizontais de uma série (sem legenda: o título nomeia a série). */
export function BarrasHorizontais({
  itens,
  cor = "#2a78d6",
}: {
  /** `cor` de um item vale no lugar da cor da série (ex.: prioridade, com a paleta do mapa). */
  itens: { rotulo: string; quantidade: number; italico?: boolean; cor?: string }[];
  cor?: string;
}) {
  const maximo = Math.max(1, ...itens.map((i) => i.quantidade));
  return (
    <ul className="flex flex-col gap-2">
      {itens.map((item) => (
        <li
          key={item.rotulo}
          className="grid grid-cols-[minmax(0,13rem)_1fr_auto] items-center gap-3 text-sm"
        >
          <span className={`truncate ${item.italico ? "italic" : ""}`} title={item.rotulo}>
            {item.rotulo}
          </span>
          <span
            className="h-3 rounded-r"
            style={{ width: `${(item.quantidade / maximo) * 100}%`, background: item.cor ?? cor }}
          />
          <span className="w-8 text-right tabular-nums">
            {item.quantidade.toLocaleString("pt-BR")}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface PontoSerie {
  data: string;
  valor: number;
}

function numeroPtBr(v: number) {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/**
 * Sparkline dos instantâneos registrados (M-11): linha de 2 px, sem eixos,
 * ponto final marcado. Com menos de 2 pontos não desenha nada.
 */
export function Sparkline({ serie, unidade = "" }: { serie: PontoSerie[]; unidade?: string }) {
  if (serie.length < 2) return null;
  const largura = 96;
  const altura = 28;
  const margem = 4;
  const valores = serie.map((p) => p.valor);
  const minimo = Math.min(...valores);
  const amplitude = Math.max(...valores) - minimo || 1;
  const pontos = serie.map((p, k) => ({
    x: margem + (k * (largura - 2 * margem)) / (serie.length - 1),
    y: altura - margem - ((p.valor - minimo) / amplitude) * (altura - 2 * margem),
  }));
  const fim = pontos[pontos.length - 1]!;
  const primeiro = serie[0]!;
  const ultimo = serie[serie.length - 1]!;
  const sufixo = unidade === "%" ? "%" : "";
  const rotulo =
    `Tendência: ${numeroPtBr(primeiro.valor)}${sufixo} em ${formatarDataCurta(primeiro.data)} ` +
    `a ${numeroPtBr(ultimo.valor)}${sufixo} em ${formatarDataCurta(ultimo.data)}`;
  return (
    <svg
      role="img"
      aria-label={rotulo}
      viewBox={`0 0 ${largura} ${altura}`}
      width={largura}
      height={altura}
      className="mt-1"
    >
      <polyline
        points={pontos.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
        fill="none"
        stroke={CORES_SERIES[0]}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={fim.x}
        cy={fim.y}
        r={3}
        fill={CORES_SERIES[0]}
        strokeWidth={1.5}
        className="stroke-superficie"
      />
    </svg>
  );
}
