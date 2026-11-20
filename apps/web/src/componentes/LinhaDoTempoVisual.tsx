import {
  useArvoresLinhaDoTempo,
  type EventoLinhaDoTempo,
  type PontoMedida,
  type SerieMedida,
} from "@itree/api-client";
import { ROTULOS_CONDICAO } from "@itree/domain";
import { Link } from "@tanstack/react-router";
import {
  CircleCheck,
  ClipboardCheck,
  Ruler,
  Scissors,
  Sprout,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { CORES_CONDICAO } from "../mapa/simbologia";
import { Carregando, Erro } from "../ui/estados";
import { cn } from "../util/cn";
import { formatarData } from "../util/formatos";
import { NIVEIS_CONDICAO, degraus, nivelDaCondicao, posicaoNaEscala } from "./linhaDoTempoVisual";

export type AbaDestino = "medidas" | "historico";

const ICONES: Record<EventoLinhaDoTempo["tipo"], LucideIcon> = {
  cadastro: Sprout,
  medicao: Ruler,
  inspecao: ClipboardCheck,
  ocorrencia: TriangleAlert,
  tarefa: CircleCheck,
  poda: Scissors,
};

const ROTULOS_TIPO: Record<EventoLinhaDoTempo["tipo"], string> = {
  cadastro: "Cadastro",
  medicao: "Medição",
  inspecao: "Inspeção",
  ocorrencia: "Ocorrência",
  tarefa: "Tarefa concluída",
  poda: "Poda",
};

const ROTA: Partial<Record<EventoLinhaDoTempo["tipo"], string>> = {
  inspecao: "/inspecoes/$id",
  ocorrencia: "/ocorrencias/$id",
  tarefa: "/equipes-tarefas/$id",
  poda: "/equipes-tarefas/$id",
};

/**
 * Faixa horizontal com os eventos da árvore (cadastro, medições, inspeções com a condição em
 * cor, ocorrências, tarefas e podas) e, abaixo, a condição ao longo do tempo (degraus) e as
 * medidas. Passar o cursor ou focar mostra o resumo; clicar vai ao evento.
 */
export function LinhaDoTempoVisual({
  arvoreId,
  aoIrParaAba,
}: {
  arvoreId: string;
  aoIrParaAba: (aba: AbaDestino) => void;
}) {
  const consulta = useArvoresLinhaDoTempo(arvoreId);
  const [ativoId, setAtivoId] = useState<string | null>(null);
  if (consulta.isPending) return <Carregando linhas={2} />;
  if (consulta.isError)
    return <Erro erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />;
  const { eventos, condicao, medidas } = consulta.data.data;
  const ativo = eventos.find((e) => e.id === ativoId);

  return (
    <section aria-labelledby="titulo-linha-tempo" className="flex flex-col gap-3">
      <h2 id="titulo-linha-tempo" className="font-semibold">
        Linha do tempo
      </h2>
      <div className="overflow-x-auto rounded-lg border border-borda bg-superficie px-4 pt-4 pb-2">
        <ol className="relative flex min-w-max items-start gap-0">
          {eventos.map((e, i) => (
            <li key={e.id} className="relative flex w-24 flex-col items-center">
              {/* Trilho entre os marcadores. */}
              <span
                aria-hidden
                className={cn(
                  "absolute top-4 h-0.5 bg-borda",
                  i === 0 ? "left-1/2 w-1/2" : i === eventos.length - 1 ? "left-0 w-1/2" : "w-full",
                  eventos.length === 1 && "hidden",
                )}
              />
              <Marcador
                evento={e}
                aoAtivar={() => setAtivoId(e.id)}
                aoDesativar={() => setAtivoId((a) => (a === e.id ? null : a))}
                aoIrParaAba={aoIrParaAba}
              />
              <span className="mt-1 text-xs font-medium">{formatarData(e.data)}</span>
              <span className="text-[11px] text-texto-suave">{ROTULOS_TIPO[e.tipo]}</span>
            </li>
          ))}
        </ol>
      </div>
      <p
        aria-live="polite"
        className="min-h-12 rounded-md bg-fundo px-3 py-2 text-sm"
        data-testid="resumo-evento"
      >
        {ativo ? (
          <>
            <span className="font-medium">{ativo.titulo}</span>
            <span className="text-texto-suave"> · {formatarData(ativo.data)}</span>
            {ativo.resumo && <span className="block">{ativo.resumo}</span>}
          </>
        ) : (
          <span className="text-texto-suave">
            Passe o cursor ou use Tab sobre um evento para ver o resumo; clique para abrir.
            {" O marcador da inspeção tem a cor da condição aparente validada."}
          </span>
        )}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <GraficoCondicao pontos={condicao} />
        <GraficosMedidas series={medidas} />
      </div>
    </section>
  );
}

function Marcador({
  evento,
  aoAtivar,
  aoDesativar,
  aoIrParaAba,
}: {
  evento: EventoLinhaDoTempo;
  aoAtivar: () => void;
  aoDesativar: () => void;
  aoIrParaAba: (aba: AbaDestino) => void;
}) {
  const Icone = ICONES[evento.tipo];
  const cor = evento.condicao ? CORES_CONDICAO[nivelDaCondicao(evento.condicao)] : undefined;
  const rotulo = `${evento.titulo}, ${formatarData(evento.data)}`;
  const classe =
    "relative z-10 flex size-8 items-center justify-center rounded-full border-2 border-white bg-neutro-clara text-texto shadow ring-1 ring-borda focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca";
  const props = {
    "aria-label": rotulo,
    className: classe,
    style: cor ? { backgroundColor: cor, color: "#fff" } : undefined,
    onMouseEnter: aoAtivar,
    onMouseLeave: aoDesativar,
    onFocus: aoAtivar,
    onBlur: aoDesativar,
  };
  const rota = ROTA[evento.tipo];
  if (rota && evento.origem_id)
    return (
      <Link to={rota} params={{ id: evento.origem_id }} {...props}>
        <Icone className="size-4" aria-hidden />
      </Link>
    );
  return (
    <button
      type="button"
      {...props}
      onClick={() => aoIrParaAba(evento.tipo === "medicao" ? "medidas" : "historico")}
    >
      <Icone className="size-4" aria-hidden />
    </button>
  );
}

const L = 520;
const MARGEM_ESQ = 104;
const MARGEM_DIR = 16;

/** Condição aparente ao longo do tempo, em degraus, nas cores de condição do mapa. */
export function GraficoCondicao({
  pontos,
}: {
  pontos: readonly { data: string; condicao: string; inspecao_codigo: string }[];
}) {
  const titulo = "Condição aparente ao longo do tempo";
  const [agora] = useState(() => Date.now());
  if (pontos.length === 0)
    return (
      <figure className="rounded-lg border border-borda bg-superficie p-3">
        <figcaption className="mb-1 text-sm font-medium">{titulo}</figcaption>
        <p className="text-sm text-texto-suave">
          Nenhuma inspeção validada: a condição aparente ainda não foi avaliada.
        </p>
      </figure>
    );
  const lista = degraus(pontos, agora);
  const min = lista[0]!.de;
  const max = Math.max(lista[lista.length - 1]!.ate, min);
  const niveis = NIVEIS_CONDICAO.filter(
    (n) => n !== "nao_avaliada" || lista.some((d) => d.nivel === n),
  );
  const passo = 26;
  const topo = 14;
  const A = topo + niveis.length * passo + 24;
  const x = (t: number) =>
    MARGEM_ESQ + posicaoNaEscala(t, min, max) * (L - MARGEM_ESQ - MARGEM_DIR);
  const y = (n: (typeof NIVEIS_CONDICAO)[number]) => topo + niveis.indexOf(n) * passo + passo / 2;
  return (
    <figure className="rounded-lg border border-borda bg-superficie p-3">
      <figcaption className="mb-1 text-sm font-medium">{titulo}</figcaption>
      <svg
        viewBox={`0 0 ${L} ${A}`}
        role="img"
        aria-label={`${titulo}: ${lista.map((d) => `${ROTULOS_CONDICAO[d.nivel]} em ${formatarData(new Date(d.de).toISOString())}`).join("; ")}`}
        className="w-full"
      >
        {niveis.map((n) => (
          <g key={n}>
            <line
              x1={MARGEM_ESQ}
              x2={L - MARGEM_DIR}
              y1={y(n)}
              y2={y(n)}
              stroke="currentColor"
              strokeOpacity={0.12}
            />
            <text
              x={MARGEM_ESQ - 8}
              y={y(n)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="currentColor"
            >
              {ROTULOS_CONDICAO[n]}
            </text>
          </g>
        ))}
        {lista.map((d, i) => {
          const proximo = lista[i + 1];
          return (
            <g key={`${d.inspecao}-${i}`}>
              {proximo && (
                <line
                  x1={x(d.ate)}
                  x2={x(d.ate)}
                  y1={y(d.nivel)}
                  y2={y(proximo.nivel)}
                  stroke="#6b756f"
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                />
              )}
              <line
                x1={x(d.de)}
                x2={Math.max(x(d.ate), x(d.de) + 1)}
                y1={y(d.nivel)}
                y2={y(d.nivel)}
                stroke={CORES_CONDICAO[d.nivel]}
                strokeWidth={5}
                strokeLinecap="round"
              />
              <circle
                data-testid={`ponto-condicao-${d.nivel}`}
                cx={x(d.de)}
                cy={y(d.nivel)}
                r={6}
                fill={CORES_CONDICAO[d.nivel]}
                stroke="#fff"
                strokeWidth={2}
              >
                <title>{`${ROTULOS_CONDICAO[d.nivel]}, inspeção ${d.inspecao} (${formatarData(new Date(d.de).toISOString())})`}</title>
              </circle>
            </g>
          );
        })}
        <text x={MARGEM_ESQ} y={A - 4} fontSize={11} fill="currentColor" fillOpacity={0.7}>
          {formatarData(new Date(min).toISOString())}
        </text>
        <text
          x={L - MARGEM_DIR}
          y={A - 4}
          fontSize={11}
          textAnchor="end"
          fill="currentColor"
          fillOpacity={0.7}
        >
          hoje
        </text>
      </svg>
      <p className="mt-1 text-xs text-texto-suave">
        Só inspeções validadas. A condição vale até a inspeção seguinte.
      </p>
    </figure>
  );
}

/** Altura e DAP ao longo do tempo, com a unidade, quando há medidas. */
function GraficosMedidas({ series }: { series: readonly SerieMedida[] }) {
  if (series.length === 0)
    return (
      <figure className="rounded-lg border border-borda bg-superficie p-3">
        <figcaption className="mb-1 text-sm font-medium">Altura e DAP ao longo do tempo</figcaption>
        <p className="text-sm text-texto-suave">Sem medidas registradas para esta árvore.</p>
      </figure>
    );
  return (
    <div className="flex flex-col gap-3">
      {series.map((s) => (
        <GraficoMedida key={s.tipo} serie={s} />
      ))}
    </div>
  );
}

const ROTULO_SERIE = { altura: "Altura", dap: "DAP" } as const;

function GraficoMedida({ serie }: { serie: SerieMedida }) {
  const nome = `${ROTULO_SERIE[serie.tipo]} (${serie.unidade})`;
  const pontos: PontoMedida[] = serie.pontos;
  const tempos = pontos.map((p) => Date.parse(p.data));
  const valores = pontos.map((p) => p.valor);
  const [tmin, tmax] = [Math.min(...tempos), Math.max(...tempos)];
  const vmax = Math.max(...valores) * 1.15 || 1;
  const A = 110;
  const x = (t: number) => 40 + posicaoNaEscala(t, tmin, tmax) * (L - 40 - 24);
  const y = (v: number) => 14 + (1 - v / vmax) * (A - 14 - 24);
  const caminho = pontos.map((p) => `${x(Date.parse(p.data))},${y(p.valor)}`).join(" ");
  const fmt = (v: number) => v.toLocaleString("pt-BR");
  return (
    <figure className="rounded-lg border border-borda bg-superficie p-3">
      <figcaption className="mb-1 text-sm font-medium">{nome} ao longo do tempo</figcaption>
      <svg
        viewBox={`0 0 ${L} ${A}`}
        role="img"
        aria-label={`${nome}: ${pontos.map((p) => `${fmt(p.valor)} ${p.unidade} em ${formatarData(p.data)}`).join("; ")}`}
        className="w-full"
      >
        <line
          x1={40}
          x2={L - 24}
          y1={A - 24}
          y2={A - 24}
          stroke="currentColor"
          strokeOpacity={0.2}
        />
        <text x={36} y={14} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.7}>
          {serie.unidade}
        </text>
        {pontos.length > 1 && (
          <polyline points={caminho} fill="none" stroke="#1f6b45" strokeWidth={2} />
        )}
        {pontos.map((p, i) => (
          <g key={`${p.data}-${i}`}>
            <circle
              data-testid={`ponto-${serie.tipo}`}
              cx={x(Date.parse(p.data))}
              cy={y(p.valor)}
              r={4.5}
              fill={p.origem === "estimado" ? "#fff" : "#1f6b45"}
              stroke="#1f6b45"
              strokeWidth={2}
            >
              <title>{`${fmt(p.valor)} ${p.unidade} em ${formatarData(p.data)}${p.origem === "estimado" ? " (estimado)" : ""}`}</title>
            </circle>
            <text
              x={x(Date.parse(p.data))}
              y={y(p.valor) - 8}
              textAnchor="middle"
              fontSize={11}
              fill="currentColor"
            >
              {fmt(p.valor)}
            </text>
          </g>
        ))}
        <text x={40} y={A - 6} fontSize={11} fill="currentColor" fillOpacity={0.7}>
          {formatarData(pontos[0]!.data)}
        </text>
        {pontos.length > 1 && (
          <text
            x={L - 24}
            y={A - 6}
            fontSize={11}
            textAnchor="end"
            fill="currentColor"
            fillOpacity={0.7}
          >
            {formatarData(pontos[pontos.length - 1]!.data)}
          </text>
        )}
      </svg>
      <p className="mt-1 text-xs text-texto-suave">Ponto vazado = valor estimado.</p>
    </figure>
  );
}
